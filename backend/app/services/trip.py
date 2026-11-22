"""Trip pipeline: what the GB server decides after Identify, at entry and at exit.

ENTRY (truck comes in)                          EXIT (truck goes out)
  Identify    (identify.py)                       Identify    again, from scratch
  Eligibility hold, open pass, period, hours,     Pass check  QR / SMS code / no-QR fallback: signature, unused,
              trip / tonne / vehicle quota                    same truck, not expired
  Measure     entry weight vs enrolled empty      Measure     net = exit - entry weight: overload, empty, bypass
  Pass        issue signed pass (reserves 1 trip) Compare     trip confirmed, tonnes, quota warnings, hours
  Barrier     lifts only if a pass was issued     Barrier     lifts only on a valid close; forced = illegal trip

Every refusal and every suspicious fact becomes an Alert (with severity) and a log line. Holds freeze trucks
involved in clone / pass-misuse cases until an officer releases them. All state is scoped to one permit.
Rules referenced as in docs/implementation/rules_spec.md.
"""

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Alert, Movement, Pass, Permit, Truck, TruckHold
from app.services import passes as passcrypto
from app.services.identify import CHECK_LABEL, NA, Decision
from app.services.logbus import LogLine

IST = timezone(timedelta(hours=5, minutes=30))

LIGHT_VEHICLE_MAX_M = 6.0  # C2: shorter vehicles are logged, not trips
ARRIVED_LOADED_MARGIN_T = 1.0  # M2
EMPTY_EXIT_T = 0.5  # M5
OVERLOAD_HIGH_RATIO = 0.10  # M3: more than 10% over rated capacity = High
NO_QR_CLOSES_PER_DAY = 1  # P9
THRESHOLDS = ((1.0, "100PCT", "HIGH"), (0.9, "90PCT", "MEDIUM"), (0.8, "80PCT", "INFO"))  # CP5

LEVEL = {"INFO": "INFO", "MEDIUM": "WARN", "HIGH": "ALERT", "CRITICAL": "CRITICAL"}

# Identify results that refuse entry / exit, with the alert they raise
IDENTIFY_ALERT = {
    "MISMATCH": ("POSSIBLE_CLONE", "HIGH", "Plate, FASTag and length do not agree: possible cloned plate or stolen tag"),
    "UNREGISTERED": ("UNREGISTERED_VEHICLE", "HIGH", "Vehicle is not in the GB registry"),
    "UNIDENTIFIED": ("UNIDENTIFIED_VEHICLE", "HIGH", "Vehicle could not be positively identified (default deny)"),
    "NOT_AUTHORISED": ("NOT_AUTHORISED", "MEDIUM", "Registered truck is not authorised to work today"),
}


# ---------------------------------------------------------------- step view (what the dashboard shows)
@dataclass
class Item:
    label: str
    status: str  # passed | failed | info
    detail: str

    def as_dict(self) -> dict:
        return {"label": self.label, "status": self.status, "detail": self.detail}


@dataclass
class Step:
    name: str
    items: list[Item] = field(default_factory=list)

    def add(self, label: str, status: str, detail: str) -> None:
        self.items.append(Item(label, status, detail))

    @property
    def status(self) -> str:
        if any(i.status == "failed" for i in self.items):
            return "failed"
        if any(i.status == "warning" for i in self.items):
            return "warning"
        return "passed"

    def as_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "items": [i.as_dict() for i in self.items]}


# ---------------------------------------------------------------- context for one gate event
@dataclass
class Trip:
    db: Session
    permit: Permit
    movement: Movement
    decision: Decision
    involved: list[Truck]  # trucks named by the plate and by the tag (for clone holds)
    pass_token: str | None = None
    pass_code: str | None = None
    lines: list[LogLine] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    issued: Pass | None = None

    # -- helpers
    @property
    def at(self) -> datetime:
        return self.movement.observed_at

    @property
    def local(self) -> datetime:
        return self.at.astimezone(IST)

    def log(self, component: str, level: str, message: str, context: dict | None = None) -> None:
        self.lines.append(LogLine(component, level, message, context))

    def step(self, name: str) -> Step:
        s = Step(name)
        self.steps.append(s)
        return s

    def alert(self, code: str, severity: str, message: str, *, truck: Truck | None = None,
              pass_: Pass | None = None) -> Alert:
        a = Alert(permit_id=self.permit.id, movement_id=self.movement.id, pass_id=pass_.id if pass_ else None,
                  truck_id=truck.id if truck else None, code=code, severity=severity, message=message,
                  status="open", source=self.movement.source)
        self.db.add(a)
        self.alerts.append(a)
        self.log("ACT", LEVEL[severity], f"{severity} {code}: {message}", {"alert": code, "severity": severity})
        return a

    def hold(self, truck: Truck, reason: str) -> None:
        if _active_hold(self.db, self.permit.id, truck.id) is not None:
            return
        self.db.add(TruckHold(permit_id=self.permit.id, truck_id=truck.id, reason_code=reason,
                              movement_id=self.movement.id))
        self.log("ACT", "ALERT", f"Truck {truck.plate} put ON HOLD ({reason}) until an officer reviews it",
                 {"hold": truck.plate, "reason": reason})

    def finish(self, *, allowed: bool, forced_note: str = "") -> None:
        """Barrier decision. A refused vehicle that forces the barrier is a recorded act of force (A2)."""
        m = self.movement
        m.decision = "ALLOWED" if allowed else "REFUSED"
        m.barrier = "up" if allowed else "down"
        s = self.step("Barrier")
        if allowed:
            s.add("Barrier", "passed", "Barrier lifts")
            self.log("ACT", "INFO", f"{m.gate} {'entry' if m.direction == 'IN' else 'exit'} barrier UP")
        else:
            s.add("Barrier", "failed", "Barrier stays down")
            self.log("ACT", "WARN", f"{m.gate} {'entry' if m.direction == 'IN' else 'exit'} barrier stays DOWN")
            if m.barrier_forced:
                s.add("Barrier forced", "failed", "Vehicle broke through the barrier" + forced_note)
                self.alert("BARRIER_FORCED", "CRITICAL",
                           f"Barrier forced at {m.gate} {'entry' if m.direction == 'IN' else 'exit'}" + forced_note,
                           truck=self.decision.truck)
        m.steps = [st.as_dict() for st in self.steps]


# ---------------------------------------------------------------- queries
def _active_hold(db: Session, permit_id: int, truck_id: int) -> TruckHold | None:
    return db.scalar(select(TruckHold).where(TruckHold.permit_id == permit_id, TruckHold.truck_id == truck_id,
                                             TruckHold.released_at.is_(None)))


def _open_pass(db: Session, permit_id: int, truck_id: int) -> Pass | None:
    return db.scalar(select(Pass).where(Pass.permit_id == permit_id, Pass.truck_id == truck_id,
                                        Pass.status == "open").order_by(Pass.id.desc()))


def usage(db: Session, permit_id: int) -> dict:
    """Trips reserved (every issued pass counts, P13), tonnes on closed passes, distinct trucks."""
    trips = db.scalar(select(func.count()).select_from(Pass).where(Pass.permit_id == permit_id)) or 0
    tonnes = db.scalar(select(func.coalesce(func.sum(Pass.net_t), 0.0)).where(
        Pass.permit_id == permit_id, Pass.status == "closed")) or 0.0
    trucks = set(db.scalars(select(Pass.truck_id).where(Pass.permit_id == permit_id).distinct()).all())
    return {"trips": trips, "tonnes": float(tonnes), "truck_ids": trucks}


def _in_window(local_t: time, start: time, end: time) -> bool:
    return start <= local_t <= end if start <= end else (local_t >= start or local_t <= end)


def _thresholds(t: Trip, kind: str, used: float, limit: float) -> None:
    """80 / 90 / 100% warnings, each raised once per permit (CP5)."""
    if limit <= 0:
        return
    ratio = used / limit
    for level, suffix, severity in THRESHOLDS:
        if ratio >= level:
            code = f"{kind}_{suffix}"
            exists = t.db.scalar(select(Alert.id).where(Alert.permit_id == t.permit.id, Alert.code == code))
            if not exists:
                t.alert(code, severity, f"{kind.title()} at {ratio:.0%} of the permit limit ({used:g} of {limit:g})")
            return


def _identify_step(t: Trip) -> None:
    s = t.step("Identify")
    for c in t.decision.checks:
        if c.status == NA:
            continue
        s.add(CHECK_LABEL.get(c.name, c.name), c.status, c.detail)


def _light_vehicle(t: Trip) -> bool:
    length = t.movement.radar_length_m
    if length is None or length >= LIGHT_VEHICLE_MAX_M:
        return False
    s = t.step("Eligibility")
    s.add("Light vehicle", "passed", f"Radar {length:.2f} m (< {LIGHT_VEHICLE_MAX_M:g} m): logged, not a trip")
    t.log("COMPARE", "INFO", f"Light vehicle ({length:.2f} m): logged, not counted as a trip (rule C2)")
    t.finish(allowed=True)
    return True


def _refuse_identity(t: Trip, s: Step) -> None:
    d = t.decision
    code, severity, message = IDENTIFY_ALERT[d.result]
    s.add("Identity", "failed", f"Identify result {d.result}")
    t.alert(code, severity, message, truck=d.truck)
    if d.result == "MISMATCH":  # I7: freeze both the plate's truck and the tag's truck
        for truck in t.involved:
            t.hold(truck, "POSSIBLE_CLONE")


# ---------------------------------------------------------------- ENTRY
def process_entry(t: Trip) -> None:
    _identify_step(t)
    if _light_vehicle(t):
        return
    d, p, m = t.decision, t.permit, t.movement
    s = t.step("Eligibility")

    if d.result != "AUTHORISED":
        _refuse_identity(t, s)
        return t.finish(allowed=False, forced_note=" by a vehicle that was refused entry; it is inside with no pass")
    truck = d.truck
    assert truck is not None
    s.add("Identity", "passed", f"{truck.plate} identified and authorised")

    def refuse(label: str, code: str, severity: str, message: str) -> None:
        s.add(label, "failed", message)
        t.alert(code, severity, message, truck=truck)
        t.finish(allowed=False, forced_note=" by a vehicle that was refused entry; it is inside with no pass")

    # Holds (A4)
    hold = _active_hold(t.db, p.id, truck.id)
    if hold:
        return refuse("Not on hold", "TRUCK_ON_HOLD", "HIGH",
                      f"{truck.plate} is on hold ({hold.reason_code}) pending officer review")
    s.add("Not on hold", "passed", "No hold on this truck")

    # One open pass per truck (P2): a second copy of this plate is inside, or this one never exited
    open_pass = _open_pass(t.db, p.id, truck.id)
    if open_pass:
        msg = (f"{truck.plate} already has open pass {open_pass.code} (issued "
               f"{open_pass.issued_at.astimezone(IST):%H:%M}); a second vehicle with the same identity is at the gate")
        s.add("No open pass", "failed", msg)
        t.alert("CLONE_SUSPECT", "HIGH", msg, truck=truck, pass_=open_pass)
        t.hold(truck, "CLONE_SUSPECT")
        return t.finish(allowed=False, forced_note=" by a vehicle that was refused entry; it is inside with no pass")
    s.add("No open pass", "passed", "No open pass for this truck")

    # Permit period and hours (CP1, P15)
    local = t.local
    if not (p.valid_from <= local.date() <= p.valid_to):
        return refuse("Permit period", "PERMIT_INACTIVE", "MEDIUM",
                      f"{local:%d %b %Y} is outside the permit period {p.valid_from} to {p.valid_to}")
    if not _in_window(local.time(), p.hours_start, p.hours_end):
        return refuse("Working hours", "OUTSIDE_HOURS", "MEDIUM",
                      f"Entry at {local:%H:%M} is outside permitted hours "
                      f"{p.hours_start:%H:%M} to {p.hours_end:%H:%M}; no pass issued")
    s.add("Working hours", "passed", f"{local:%H:%M} within {p.hours_start:%H:%M} to {p.hours_end:%H:%M}")

    # Quota (CP5, CP7, P13)
    u = usage(t.db, p.id)
    if u["trips"] >= p.trip_limit:
        return refuse("Trip quota", "TRIP_LIMIT", "MEDIUM",
                      f"Trip limit reached ({u['trips']} of {p.trip_limit}); pass issuing stopped")
    if u["tonnes"] >= p.tonne_limit:
        return refuse("Tonne quota", "TONNE_LIMIT", "MEDIUM",
                      f"Tonne limit reached ({u['tonnes']:.1f} of {p.tonne_limit:g} t); pass issuing stopped")
    if truck.id not in u["truck_ids"] and len(u["truck_ids"]) >= p.vehicle_limit:
        return refuse("Vehicle quota", "VEHICLE_LIMIT", "HIGH",
                      f"{truck.plate} would be vehicle {len(u['truck_ids']) + 1} of a permitted {p.vehicle_limit}")
    s.add("Quota", "passed", f"Trips used {u['trips']} of {p.trip_limit}, tonnes {u['tonnes']:.1f} of "
                             f"{p.tonne_limit:g}, vehicles {len(u['truck_ids'])} of {p.vehicle_limit}")
    t.log("COMPARE", "INFO", f"Eligible: hours OK, trips {u['trips']}/{p.trip_limit}, tonnes "
                             f"{u['tonnes']:.1f}/{p.tonne_limit:g}, vehicles {len(u['truck_ids'])}/{p.vehicle_limit}")

    # Measure entry weight (M1, M2, M4)
    ms = t.step("Measure")
    entry_weight, measured = m.weight_t, True
    if entry_weight is None:
        entry_weight, measured = truck.empty_weight_t, False
        ms.add("Entry weight", "failed", "No weigh pad reading; using enrolled empty weight "
                                         f"{truck.empty_weight_t:.2f} t")
        t.alert("WEIGH_BYPASS", "HIGH", f"{truck.plate} entered without a weigh pad reading", truck=truck)
    elif entry_weight > truck.empty_weight_t + ARRIVED_LOADED_MARGIN_T:
        ms.add("Entry weight", "warning", f"{entry_weight:.2f} t vs enrolled empty {truck.empty_weight_t:.2f} t: "
                                          "arrived loaded")
        t.alert("ARRIVED_LOADED", "MEDIUM",
                f"{truck.plate} arrived weighing {entry_weight:.2f} t, {entry_weight - truck.empty_weight_t:.2f} t "
                f"above its enrolled empty weight", truck=truck)
    else:
        ms.add("Entry weight", "passed", f"{entry_weight:.2f} t (enrolled empty {truck.empty_weight_t:.2f} t)")
    t.log("MEASURE", "INFO", f"Entry weight {entry_weight:.2f} t" + ("" if measured else " (fallback)"))

    # Issue the pass (P1, P3, P4, P13)
    ps = t.step("Pass")
    expires = t.at + timedelta(minutes=p.pass_expiry_min)
    pss = Pass(code="pending", permit_id=p.id, truck_id=truck.id, entry_movement_id=m.id, entry_gate=m.gate,
               issued_at=t.at, expires_at=expires, entry_weight_t=entry_weight, entry_weight_measured=measured,
               status="open", token="", sms_code="", flags=[], source=m.source)
    t.db.add(pss)
    t.db.flush()
    pss.code = f"P-{pss.id:04d}"
    pss.token = passcrypto.sign(t.db, {
        "pass": pss.code, "permit": p.id, "plate": truck.plate, "fastag": truck.fastag_tag_id, "gate": m.gate,
        "issued_at": t.at.isoformat(), "expires_at": expires.isoformat(), "entry_weight_t": entry_weight,
    })
    pss.sms_code = passcrypto.sms_code(t.db, pss.id)
    m.pass_id = pss.id
    t.issued = pss
    ps.add("Pass issued", "passed", f"{pss.code} signed (Ed25519), SMS code {pss.sms_code}, "
                                    f"expires {expires.astimezone(IST):%H:%M}")
    t.log("PASS", "INFO", f"Pass {pss.code} issued to {truck.plate}, signed, SMS code {pss.sms_code}, "
                          f"expires {expires.astimezone(IST):%H:%M}; 1 trip reserved",
          {"pass": pss.code})
    after = usage(t.db, p.id)
    _thresholds(t, "TRIPS", after["trips"], p.trip_limit)
    t.finish(allowed=True)


# ---------------------------------------------------------------- EXIT
def _find_pass(t: Trip, s: Step, truck: Truck) -> tuple[Pass | None, str | None]:
    """The pass presented at exit (QR, SMS code, or none -> the truck's open pass). Returns (pass, close_mode)."""
    db, p = t.db, t.permit
    if t.pass_token:
        payload = passcrypto.verify(db, t.pass_token)
        if payload is None:
            s.add("Signature", "failed", "QR signature invalid: forged or edited")
            t.alert("INVALID_PASS", "HIGH", "QR presented at exit has an invalid signature (forged or edited)",
                    truck=truck)
            return None, None
        pss = db.scalar(select(Pass).where(Pass.code == payload.get("pass")))
        if pss is None or pss.permit_id != p.id:
            s.add("Signature", "failed", "QR is genuine but not for this site / permit")
            t.alert("INVALID_PASS", "HIGH", "QR presented at exit is not a pass for this permit", truck=truck)
            return None, None
        s.add("Signature", "passed", f"QR signature valid: pass {pss.code}")
        return pss, "qr"
    if t.pass_code:
        code = t.pass_code.strip().upper()
        pss = db.scalar(select(Pass).where(Pass.permit_id == p.id, Pass.sms_code == code))
        if pss is None:
            s.add("SMS code", "failed", f"Code {code} does not match any pass")
            t.alert("INVALID_PASS", "HIGH", f"SMS code {code} presented at exit matches no pass", truck=truck)
            return None, None
        s.add("SMS code", "passed", f"Code matches pass {pss.code}")
        return pss, "sms"
    # P9: no QR or code. Close by plate + FASTag + length against the truck's open pass, limited per day.
    pss = _open_pass(db, p.id, truck.id)
    if pss is None:
        s.add("Pass presented", "failed", "No pass presented and no open pass: no entry through a GB gate")
        t.alert("NO_PASS", "HIGH", f"{truck.plate} at exit with no open pass (did not enter through a GB gate, "
                                   "or entered without a pass)", truck=truck)
        return None, None
    hold = _active_hold(db, p.id, truck.id)
    if hold is not None:  # a held identity may be cloned: only the QR / SMS code can close its pass
        s.add("Pass presented", "failed", f"No QR / code, and {truck.plate} is on hold ({hold.reason_code}): "
                                          "the no-QR close is not allowed")
        t.alert("NO_QR_ON_HOLD", "HIGH", f"{truck.plate} at exit without QR while on hold ({hold.reason_code}); "
                                         "possible clone trying to close the real truck's pass", truck=truck, pass_=pss)
        return None, None
    day_start = t.local.replace(hour=0, minute=0, second=0, microsecond=0)
    used_today = db.scalar(select(func.count()).select_from(Pass).where(
        Pass.permit_id == p.id, Pass.truck_id == truck.id, Pass.close_mode == "no_qr",
        Pass.closed_at >= day_start)) or 0
    if used_today >= NO_QR_CLOSES_PER_DAY:
        s.add("Pass presented", "failed", f"No QR / code, and the no-QR close was already used today "
                                          f"({used_today} of {NO_QR_CLOSES_PER_DAY})")
        t.alert("NO_QR_LIMIT", "MEDIUM", f"{truck.plate} at exit without QR again today; barrier stays down until "
                                         "an officer approves", truck=truck, pass_=pss)
        return None, None
    s.add("Pass presented", "warning", f"No QR / code: matched open pass {pss.code} by plate + FASTag + length")
    return pss, "no_qr"


def process_exit(t: Trip) -> None:
    _identify_step(t)
    if _light_vehicle(t):
        return
    d, p, m = t.decision, t.permit, t.movement
    forced = " by a vehicle without a valid pass: counted as an ILLEGAL trip"
    s = t.step("Pass check")

    if d.result not in ("AUTHORISED", "NOT_AUTHORISED"):
        _refuse_identity(t, s)
        return _exit_refused(t, forced)
    truck = d.truck
    assert truck is not None
    s.add("Identity", "passed", f"{truck.plate} identified")
    if d.result == "NOT_AUTHORISED":  # lapsed mid-trip: don't trap the truck, but record it
        t.alert("AUTHORISATION_LAPSED", "INFO", f"{truck.plate} is no longer authorised ({'; '.join(d.reasons)}); "
                                                "exit allowed for the trip in progress", truck=truck)

    pss, mode = _find_pass(t, s, truck)
    if pss is None:
        return _exit_refused(t, forced)

    if pss.status == "closed":  # P6
        msg = f"Pass {pss.code} was already used at {pss.closed_at.astimezone(IST):%H:%M}"
        s.add("Not used before", "failed", msg)
        t.alert("PASS_REUSE", "HIGH", f"{msg}; presented again by {truck.plate}", truck=truck, pass_=pss)
        t.hold(truck, "PASS_REUSE")
        return _exit_refused(t, forced)
    s.add("Not used before", "passed", f"Pass {pss.code} is open")

    if pss.truck_id != truck.id:  # P7
        msg = f"Pass {pss.code} belongs to {pss.truck.plate}, presented by {truck.plate}"
        s.add("Same truck", "failed", msg)
        t.alert("PASS_MISMATCH", "HIGH", msg, truck=truck, pass_=pss)
        t.hold(truck, "PASS_MISMATCH")
        t.hold(pss.truck, "PASS_MISMATCH")
        return _exit_refused(t, forced)
    s.add("Same truck", "passed", f"Pass {pss.code} belongs to {truck.plate}")

    if t.at > pss.expires_at:  # P11
        msg = (f"Pass {pss.code} expired at {pss.expires_at.astimezone(IST):%H:%M}; exit at {t.local:%H:%M}. "
               "Officer approval needed for a late close; the trip stays counted")
        s.add("Not expired", "failed", msg)
        t.alert("PASS_EXPIRED_AT_EXIT", "MEDIUM", msg, truck=truck, pass_=pss)
        return _exit_refused(t, forced)
    s.add("Not expired", "passed", f"Valid until {pss.expires_at.astimezone(IST):%H:%M}")
    if mode == "no_qr":
        t.alert("CLOSED_WITHOUT_QR", "MEDIUM", f"{truck.plate} closed pass {pss.code} without QR / code "
                                               "(plate + FASTag + length match)", truck=truck, pass_=pss)

    # Measure (M1, M3, M4, M5)
    ms = t.step("Measure")
    net = None
    if m.weight_t is None:
        ms.add("Exit weight", "failed", "No weigh pad reading: net tonnes unknown")
        t.alert("WEIGH_BYPASS", "HIGH", f"{truck.plate} exited without a weigh pad reading; load not measured",
                truck=truck, pass_=pss)
    else:
        net = round(m.weight_t - pss.entry_weight_t, 2)
        ms.add("Net load", "passed", f"{m.weight_t:.2f} t out - {pss.entry_weight_t:.2f} t in = {net:.2f} t")
        if net > truck.rated_capacity_t:
            over = net / truck.rated_capacity_t - 1
            sev = "HIGH" if over > OVERLOAD_HIGH_RATIO else "MEDIUM"
            ms.add("Within capacity", "warning", f"{net:.2f} t vs rated {truck.rated_capacity_t:g} t "
                                                 f"({over:.0%} over)")
            t.alert("OVERLOAD", sev, f"{truck.plate} carrying {net:.2f} t, {over:.0%} over its rated "
                                     f"{truck.rated_capacity_t:g} t", truck=truck, pass_=pss)
        elif net < EMPTY_EXIT_T:
            ms.add("Loaded", "warning", f"Net {net:.2f} t: left empty (trip still counts)")
            t.alert("EMPTY_EXIT", "MEDIUM", f"{truck.plate} left with {net:.2f} t; the reserved trip still counts",
                    truck=truck, pass_=pss)
        else:
            ms.add("Within capacity", "passed", f"Rated {truck.rated_capacity_t:g} t")
        t.log("MEASURE", "INFO", f"Exit weight {m.weight_t:.2f} t, net {net:.2f} t")

    # Close the pass (P5)
    pss.status, pss.close_mode, pss.closed_at = "closed", mode, t.at
    pss.exit_movement_id, pss.exit_weight_t, pss.net_t = m.id, m.weight_t, net
    m.pass_id = pss.id
    m.counted_trip, m.trip = True, "LEGAL"
    t.log("PASS", "INFO", f"Pass {pss.code} closed ({mode.replace('_', ' ')})"
                          + (f" with {net:.2f} t" if net is not None else ""), {"pass": pss.code})

    # Compare (CP2, CP5, CP8, P15)
    cs = t.step("Compare")
    t.db.flush()
    u = usage(t.db, p.id)
    legal = t.db.scalar(select(func.count()).select_from(Pass).where(Pass.permit_id == p.id,
                                                                     Pass.status == "closed")) or 0
    cs.add("Legal trip", "passed", f"Trip confirmed: {legal} legal of {p.trip_limit} permitted")
    cs.add("Tonnes", "passed", f"{u['tonnes']:.1f} of {p.tonne_limit:g} t")
    t.log("COMPARE", "INFO", f"Legal trips {legal}/{p.trip_limit}, tonnes {u['tonnes']:.1f}/{p.tonne_limit:g}")
    _thresholds(t, "TONNES", u["tonnes"], p.tonne_limit)
    end = datetime.combine(t.local.date(), p.hours_end, tzinfo=IST) + timedelta(minutes=p.exit_grace_min)
    if t.local > end:
        msg = (f"Exit at {t.local:%H:%M}, after hours end {p.hours_end:%H:%M} + {p.exit_grace_min} min grace")
        cs.add("Working hours", "warning", msg)
        t.alert("OUTSIDE_HOURS", "MEDIUM", msg, truck=truck, pass_=pss)
    else:
        cs.add("Working hours", "passed", f"{t.local:%H:%M}, within hours (+{p.exit_grace_min} min grace)")
    t.finish(allowed=True)


def _exit_refused(t: Trip, forced_note: str) -> None:
    m = t.movement
    if m.barrier_forced and (m.radar_length_m or 0) >= LIGHT_VEHICLE_MAX_M:
        m.counted_trip, m.trip = True, "ILLEGAL"  # P12: an OUT with no pass closure
    t.finish(allowed=False, forced_note=forced_note)
    if m.trip == "ILLEGAL":
        t.alert("ILLEGAL_TRIP", "CRITICAL", "Heavy vehicle left the site without a valid pass close",
                truck=t.decision.truck)


def process(t: Trip) -> None:
    if t.movement.direction == "IN":
        process_entry(t)
    else:
        process_exit(t)


# ---------------------------------------------------------------- ledger (Compare, for dashboards)
def ledger(db: Session, permit: Permit) -> dict:
    u = usage(db, permit.id)
    legal = db.scalar(select(func.count()).select_from(Pass).where(Pass.permit_id == permit.id,
                                                                   Pass.status == "closed")) or 0
    open_ = db.scalar(select(func.count()).select_from(Pass).where(Pass.permit_id == permit.id,
                                                                   Pass.status == "open")) or 0
    actual = db.scalar(select(func.count()).select_from(Movement).where(Movement.permit_id == permit.id,
                                                                        Movement.counted_trip.is_(True))) or 0
    illegal = db.scalar(select(func.count()).select_from(Movement).where(Movement.permit_id == permit.id,
                                                                         Movement.trip == "ILLEGAL")) or 0
    holds = db.scalar(select(func.count()).select_from(TruckHold).where(TruckHold.permit_id == permit.id,
                                                                        TruckHold.released_at.is_(None))) or 0
    sev = dict(db.execute(select(Alert.severity, func.count()).where(Alert.permit_id == permit.id)
                          .group_by(Alert.severity)).all())
    return {
        "permit_id": permit.id,
        "trip_limit": permit.trip_limit,
        "tonne_limit": permit.tonne_limit,
        "vehicle_limit": permit.vehicle_limit,
        "trips_reserved": u["trips"],
        "legal_trips": legal,
        "open_passes": open_,
        "actual_trips": actual,
        "illegal_trips": illegal,
        "tonnes": round(u["tonnes"], 2),
        "vehicles": len(u["truck_ids"]),
        "active_holds": holds,
        "alerts": {s: sev.get(s, 0) for s in ("INFO", "MEDIUM", "HIGH", "CRITICAL")},
    }


# ---------------------------------------------------------------- daily ledger and Vendor report check (CP9)
THRESHOLD_CODES = ("TRIPS_", "TONNES_")  # permit-level warnings, not about a truck


def daily_ledger(db: Session, permit: Permit) -> list[dict]:
    """Per IST day: entry attempts, passes issued, refusals, legal / actual / illegal trips, tonnes, alerts."""
    days: dict = {}

    def day(d) -> dict:
        return days.setdefault(d, {"day": d.isoformat(), "entries": 0, "passes_issued": 0, "entry_refusals": 0,
                                   "exit_refusals": 0, "legal_trips": 0, "actual_trips": 0, "illegal_trips": 0,
                                   "tonnes": 0.0, "alerts": {s: 0 for s in ("INFO", "MEDIUM", "HIGH", "CRITICAL")}})

    moves = db.scalars(select(Movement).where(Movement.permit_id == permit.id)).all()
    for m in moves:
        row = day(m.observed_at.astimezone(IST).date())
        if m.direction == "IN":
            row["entries"] += 1
            if m.decision == "ALLOWED" and m.pass_id:
                row["passes_issued"] += 1
            elif m.decision == "REFUSED":
                row["entry_refusals"] += 1
        else:
            if m.decision == "REFUSED":
                row["exit_refusals"] += 1
            if m.counted_trip:
                row["actual_trips"] += 1
            if m.trip == "LEGAL":
                row["legal_trips"] += 1
            elif m.trip == "ILLEGAL":
                row["illegal_trips"] += 1
    for p in db.scalars(select(Pass).where(Pass.permit_id == permit.id, Pass.status == "closed")).all():
        if p.closed_at is not None and p.net_t is not None:
            day(p.closed_at.astimezone(IST).date())["tonnes"] += p.net_t
    rows = db.execute(select(Alert.severity, Movement.observed_at).join(Movement, Alert.movement_id == Movement.id)
                      .where(Alert.permit_id == permit.id)).all()
    for severity, observed in rows:
        day(observed.astimezone(IST).date())["alerts"][severity] += 1
    out = [days[k] for k in sorted(days)]
    for r in out:
        r["tonnes"] = round(r["tonnes"], 2)
    return out


TONNE_TOLERANCE_PCT = 0.02  # M6-style allowance for weighbridge differences
TONNE_TOLERANCE_MIN_T = 0.5


def compare_vendor(claim_trips: int, claim_tonnes: float, gb_legal: int, gb_actual: int,
                   gb_tonnes: float) -> list[tuple[str, str, str]]:
    """CP9: the Vendor's claim for a day vs the GB's own figures. Pure; returns (code, severity, message) alerts.
    Vendor figures are never used as the source; they are only checked."""
    out = []
    if claim_trips < gb_actual:
        hidden = gb_actual - claim_trips
        below_legal = claim_trips < gb_legal
        out.append(("UNDER_REPORT", "HIGH",
                    f"Vendor reported {claim_trips} trips; GB counted {gb_actual} actual ({gb_legal} legal): "
                    f"{hidden} trip(s) not reported" + (", below even the GB-issued legal trips" if below_legal else "")))
    tolerance = max(gb_tonnes * TONNE_TOLERANCE_PCT, TONNE_TOLERANCE_MIN_T)
    if claim_tonnes < gb_tonnes - tolerance:
        out.append(("UNDER_REPORT_TONNES", "HIGH",
                    f"Vendor reported {claim_tonnes:.1f} t; GB weighed {gb_tonnes:.1f} t on legal trips "
                    f"({gb_tonnes - claim_tonnes:.1f} t not reported)"))
    return out
