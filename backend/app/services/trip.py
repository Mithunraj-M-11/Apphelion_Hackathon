"""Trip pipeline: what the GB server decides after a vehicle arrives at a barrier, at entry and at exit.

ENTRY (truck comes in)                             EXIT (truck goes out)
  Identify    plate + FASTag + length (identify.py)  Identify    again, from scratch, + the same GB RFID sticker
              + GB RFID sticker: authentic, belongs               as at entry
              to the identified truck, active
  Eligibility hold, unresolved / open trip, period,  Pass check  QR / SMS code / no-QR fallback: signature, unused,
              hours, trip / tonne / vehicle quota,               same truck + sticker, not expired
              per-vehicle allocation (if the contract sets one)
  Measure     entry weight vs enrolled empty         Measure     net = exit - entry weight: overload, empty, bypass
  Pass        trip session: Ed25519-signed QR +      Compare     trip confirmed, tonnes, quota warnings, hours
              SMS code, bound to truck + sticker;
              reserves 1 trip
  Barrier     lifts only if a pass was issued        Barrier     lifts only on a valid close; forced = illegal trip

Every refusal and every suspicious fact becomes an Alert (with severity) and a log line. Holds freeze trucks
involved in clone / pass-misuse cases until an officer releases them. Sessions past expiry are swept on every gate
event (event time) to EXPIRED_UNRESOLVED; an officer resolves them (late close). All state is scoped to one permit.
Rules referenced as in docs/implementation/rules_spec.md.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Alert,
    Movement,
    Permit,
    SyncOutbox,
    TripSession,
    Truck,
    TruckHold,
    VehicleQuota,
)
from app.models.rfid import RfidSticker
from app.models.trip import UNRESOLVED_STATUSES
from app.services import passes as passcrypto
from app.services.identify import CHECK_LABEL, NA, Decision
from app.services.logbus import LogLine
from app.services.rfid_auth import authenticate_sticker

IST = timezone(timedelta(hours=5, minutes=30))

LIGHT_VEHICLE_MAX_M = 6.0  # C2: shorter vehicles are logged, not trips
ARRIVED_LOADED_MARGIN_T = 1.0  # M2
EMPTY_EXIT_T = 0.5  # M5
OVERLOAD_HIGH_RATIO = 0.10  # M3: more than 10% over rated capacity = High
NO_QR_CLOSES_PER_DAY = 1  # P9
THRESHOLDS = ((1.0, "100PCT", "HIGH"), (0.9, "90PCT", "MEDIUM"), (0.8, "80PCT", "INFO"))  # CP5
PER_VEHICLE_LOW = 0.1  # info alert when a truck's own allocation is down to its last 10%
OPEN, DONE, CANCELLED = "ACTIVE", "COMPLETED", "CANCELLED"
CLONE_HOLDS = ("POSSIBLE_CLONE", "CLONE_SUSPECT", "RFID_CLONED", "RFID_MISMATCH")  # someone wore this identity

LEVEL = {"INFO": "INFO", "MEDIUM": "WARN", "HIGH": "ALERT", "CRITICAL": "CRITICAL"}

# Identify results that refuse entry / exit, with the alert they raise
IDENTIFY_ALERT = {
    "MISMATCH": ("POSSIBLE_CLONE", "HIGH", "Plate, FASTag and length do not agree: possible cloned plate or stolen tag"),
    "UNREGISTERED": ("UNREGISTERED_VEHICLE", "HIGH", "Vehicle is not in the GB registry"),
    "UNIDENTIFIED": ("UNIDENTIFIED_VEHICLE", "HIGH", "Vehicle could not be positively identified (default deny)"),
    "NOT_AUTHORISED": ("NOT_AUTHORISED", "MEDIUM", "Registered truck is not authorised to work today"),
}

# GB RFID sticker failures (refused for now; relaxations later), with the alert they raise
STICKER_ALERT = {
    "missing": ("RFID_MISSING", "No GB RFID sticker read (removed, shielded or not fitted)"),
    "unknown_damaged": ("RFID_UNKNOWN", "GB RFID sticker unknown, damaged or expired"),
    "cloned": ("RFID_CLONED", "GB RFID sticker failed the challenge-response: cloned or counterfeit"),
    "revoked": ("RFID_REVOKED", "GB RFID sticker has been revoked"),
    "wrong_truck": ("RFID_MISMATCH", "GB RFID sticker belongs to a different truck"),
}


# ---------------------------------------------------------------- step view (what the dashboard shows)
@dataclass
class Item:
    label: str
    status: str  # passed | failed | warning | info
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
    sticker_uid: str | None = None
    rfid_mode: str = "genuine"
    lines: list[LogLine] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    issued: TripSession | None = None
    sticker: RfidSticker | None = None
    session: TripSession | None = None  # the session issued (entry) or closed / checked (exit)
    trip_decision: str | None = None  # ENTRY AUTHORIZED | ENTRY REJECTED | EXIT AUTHORIZED | EXIT REJECTED
    quota: VehicleQuota | None = None

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
              pass_: TripSession | None = None) -> Alert:
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

    def outbox(self, event_type: str, payload: dict) -> None:
        """Queue the event for upload to the GB central server (edge sync)."""
        self.db.add(SyncOutbox(event_type=event_type, payload=payload, status="PENDING"))

    def finish(self, *, allowed: bool, forced_note: str = "") -> None:
        """Barrier decision. A refused vehicle that forces the barrier is a recorded act of force (A2)."""
        m = self.movement
        entry = m.direction == "IN"
        m.decision = "ALLOWED" if allowed else "REFUSED"
        m.barrier = "up" if allowed else "down"
        self.trip_decision = f"{'ENTRY' if entry else 'EXIT'} {'AUTHORIZED' if allowed else 'REJECTED'}"
        s = self.step("Barrier")
        if allowed:
            s.add("Barrier", "passed", "Barrier lifts")
            self.log("ACT", "INFO", f"{m.gate} {'entry' if entry else 'exit'} barrier UP")
        else:
            s.add("Barrier", "failed", "Barrier stays down")
            self.log("ACT", "WARN", f"{m.gate} {'entry' if entry else 'exit'} barrier stays DOWN")
            if m.barrier_forced:
                s.add("Barrier forced", "failed", "Vehicle broke through the barrier" + forced_note)
                self.alert("BARRIER_FORCED", "CRITICAL",
                           f"Barrier forced at {m.gate} {'entry' if entry else 'exit'}" + forced_note,
                           truck=self.decision.truck)
        m.steps = [st.as_dict() for st in self.steps]

    def trip_checks(self) -> list[dict]:
        """The steps flattened into one check list (name / status / detail) for the Gate console."""
        out = []
        for st in self.steps:
            for i in st.items:
                out.append({"name": f"{st.name}: {i.label}", "status": i.status, "detail": i.detail})
        return out


# ---------------------------------------------------------------- queries
def _active_hold(db: Session, permit_id: int, truck_id: int) -> TruckHold | None:
    return db.scalar(select(TruckHold).where(TruckHold.permit_id == permit_id, TruckHold.truck_id == truck_id,
                                             TruckHold.released_at.is_(None)))


def _session_of(db: Session, permit_id: int, truck_id: int, statuses: tuple[str, ...]) -> TripSession | None:
    return db.scalar(select(TripSession).where(TripSession.permit_id == permit_id, TripSession.truck_id == truck_id,
                                               TripSession.status.in_(statuses)).order_by(TripSession.id.desc()))


def usage(db: Session, permit_id: int) -> dict:
    """Trips reserved (every issued pass counts, P13; officer-cancelled ones don't), tonnes on closed passes,
    distinct trucks."""
    live = (TripSession.permit_id == permit_id, TripSession.status != CANCELLED)
    trips = db.scalar(select(func.count()).select_from(TripSession).where(*live)) or 0
    tonnes = db.scalar(select(func.coalesce(func.sum(TripSession.net_t), 0.0)).where(
        TripSession.permit_id == permit_id, TripSession.status == DONE)) or 0.0
    trucks = set(db.scalars(select(TripSession.truck_id).where(*live).distinct()).all())
    return {"trips": trips, "tonnes": float(tonnes), "truck_ids": trucks}


def sweep_expired(db: Session, permit: Permit, at: datetime) -> list[TripSession]:
    """P10: open passes past their expiry (at the pole's event time) become EXPIRED_UNRESOLVED. The trip stays
    counted; an officer resolves it (late close). Raises a Medium PASS_EXPIRED alert for each."""
    stale = db.scalars(select(TripSession).where(TripSession.permit_id == permit.id, TripSession.status == OPEN,
                                                 TripSession.expires_at < at)).all()
    for s in stale:
        s.status = "EXPIRED_UNRESOLVED"
        db.add(Alert(permit_id=permit.id, pass_id=s.id, truck_id=s.truck_id, code="PASS_EXPIRED", severity="MEDIUM",
                     message=f"Pass {s.trip_code} expired at {s.expires_at.astimezone(IST):%H:%M} with the truck "
                             "still inside (possible side route); trip stays counted until an officer resolves it",
                     status="open", source=permit.source))
        db.add(SyncOutbox(event_type="TRIP_EXPIRED_UNRESOLVED", payload={"trip_code": s.trip_code},
                          status="PENDING"))
    return list(stale)


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


def _identify_step(t: Trip) -> Step:
    s = t.step("Identify")
    for c in t.decision.checks:
        if c.status == NA:
            continue
        s.add(CHECK_LABEL.get(c.name, c.name), c.status, c.detail)
    return s


def _sticker_check(t: Trip, s: Step, truck: Truck) -> str | None:
    """GB RFID sticker: authentic (challenge-response), belongs to the identified truck, active. Returns the
    failure kind (key of STICKER_ALERT) or None. Records the items on the Identify step."""
    t.movement.rfid_sticker_uid = t.sticker_uid
    if not t.sticker_uid:
        s.add("GB RFID sticker", "failed", STICKER_ALERT["missing"][1])
        return "missing"
    res = authenticate_sticker(t.db, t.sticker_uid, sim_auth_mode=t.rfid_mode or "genuine")
    t.sticker = res.sticker
    if not res.authenticated:
        s.add("GB RFID sticker", "failed", res.detail)
        return res.mode if res.mode in STICKER_ALERT else "unknown_damaged"
    s.add("GB RFID sticker", "passed", res.detail)
    if res.sticker.truck_id != truck.id:
        owner = t.db.get(Truck, res.sticker.truck_id)
        s.add("Sticker belongs to truck", "failed",
              f"Sticker {res.sticker.uid} belongs to {owner.plate if owner else '#' + str(res.sticker.truck_id)}, "
              f"vehicle identified as {truck.plate}")
        return "wrong_truck"
    s.add("Sticker belongs to truck", "passed", f"Sticker {res.sticker.uid} is assigned to {truck.plate}")
    return None


def _refuse_sticker(t: Trip, s: Step, kind: str, truck: Truck) -> None:
    code, message = STICKER_ALERT[kind]
    t.alert(code, "HIGH", f"{truck.plate}: {message}", truck=truck)
    if kind in ("cloned", "wrong_truck"):  # someone is wearing another truck's identity: freeze both
        t.hold(truck, code)
        if t.sticker is not None and t.sticker.truck_id != truck.id:
            owner = t.db.get(Truck, t.sticker.truck_id)
            if owner is not None:
                t.hold(owner, code)


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


def _vehicle_quota(t: Trip, truck: Truck) -> VehicleQuota | None:
    """The truck's own allocation under this permit, if the contract sets one (created on first use)."""
    p = t.permit
    if not p.per_vehicle_trips:
        return None
    q = t.db.scalar(select(VehicleQuota).where(VehicleQuota.permit_id == p.id, VehicleQuota.truck_id == truck.id))
    if q is None:
        q = VehicleQuota(permit_id=p.id, truck_id=truck.id, max_trips=p.per_vehicle_trips, completed_trips=0,
                         remaining_trips=p.per_vehicle_trips, valid_from=p.valid_from, valid_to=p.valid_to,
                         status="AVAILABLE")
        t.db.add(q)
        t.db.flush()
    return q


# ---------------------------------------------------------------- ENTRY
def process_entry(t: Trip) -> None:
    ids = _identify_step(t)
    if _light_vehicle(t):
        return
    d, p, m = t.decision, t.permit, t.movement
    forced = " by a vehicle that was refused entry; it is inside with no pass"

    if d.result != "AUTHORISED":
        _refuse_identity(t, t.step("Eligibility"))
        return t.finish(allowed=False, forced_note=forced)
    truck = d.truck
    assert truck is not None
    kind = _sticker_check(t, ids, truck)
    if kind:
        _refuse_sticker(t, ids, kind, truck)
        return t.finish(allowed=False, forced_note=forced)

    s = t.step("Eligibility")

    def refuse(label: str, code: str, severity: str, message: str) -> None:
        s.add(label, "failed", message)
        t.alert(code, severity, message, truck=truck)
        t.finish(allowed=False, forced_note=forced)

    hold = _active_hold(t.db, p.id, truck.id)  # A4
    if hold:
        if hold.reason_code in CLONE_HOLDS:  # evidence for the officer: this vehicle carries the genuine sticker
            s.add("GB sticker on this read", "info", f"Sticker {t.sticker.uid} authenticated and is assigned to "
                                                     f"{truck.plate}: likely the genuine truck; an officer can verify "
                                                     "and release the hold")
        return refuse("Not on hold", "TRUCK_ON_HOLD", "HIGH",
                      f"{truck.plate} is on hold ({hold.reason_code}) pending officer review")
    s.add("Not on hold", "passed", "No hold on this truck")

    open_s = _session_of(t.db, p.id, truck.id, (OPEN,))  # P2: a second copy of this identity, or never exited
    if open_s:
        msg = (f"{truck.plate} already has open pass {open_s.trip_code} (issued "
               f"{open_s.entry_at.astimezone(IST):%H:%M}); a second vehicle with the same identity is at the gate")
        s.add("No open trip", "failed", msg)
        t.alert("CLONE_SUSPECT", "HIGH", msg, truck=truck, pass_=open_s)
        t.hold(truck, "CLONE_SUSPECT")
        return t.finish(allowed=False, forced_note=forced)
    unresolved = _session_of(t.db, p.id, truck.id, UNRESOLVED_STATUSES)
    if unresolved:
        return refuse("No unresolved trip", "UNRESOLVED_TRIP", "HIGH",
                      f"{truck.plate} has unresolved trip {unresolved.trip_code} ({unresolved.status}); an officer "
                      "must resolve it first (possible side-route exit)")
    s.add("No open trip", "passed", "No open or unresolved trip for this truck")

    local = t.local  # CP1, P15
    if not (p.valid_from <= local.date() <= p.valid_to):
        return refuse("Permit period", "PERMIT_INACTIVE", "MEDIUM",
                      f"{local:%d %b %Y} is outside the permit period {p.valid_from} to {p.valid_to}")
    if not _in_window(local.time(), p.hours_start, p.hours_end):
        return refuse("Working hours", "OUTSIDE_HOURS", "MEDIUM",
                      f"Entry at {local:%H:%M} is outside permitted hours "
                      f"{p.hours_start:%H:%M} to {p.hours_end:%H:%M}; no pass issued")
    s.add("Working hours", "passed", f"{local:%H:%M} within {p.hours_start:%H:%M} to {p.hours_end:%H:%M}")

    u = usage(t.db, p.id)  # CP5, CP7, P13
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
    q = _vehicle_quota(t, truck)
    t.quota = q
    if q is not None:
        if q.remaining_trips <= 0:
            return refuse("Vehicle allocation", "PER_VEHICLE_LIMIT", "MEDIUM",
                          f"{truck.plate} has used its contract allocation ({q.completed_trips} of {q.max_trips} trips)")
        s.add("Vehicle allocation", "passed", f"{q.remaining_trips} of {q.max_trips} trips left for {truck.plate}")
    t.log("COMPARE", "INFO", f"Eligible: hours OK, trips {u['trips']}/{p.trip_limit}, tonnes "
                             f"{u['tonnes']:.1f}/{p.tonne_limit:g}, vehicles {len(u['truck_ids'])}/{p.vehicle_limit}")

    ms = t.step("Measure")  # M1, M2, M4
    entry_weight, measured = m.weight_t, True
    if entry_weight is None:
        entry_weight, measured = truck.empty_weight_t, False
        ms.add("Entry weight", "failed", f"No weigh pad reading; using enrolled empty weight {truck.empty_weight_t:.2f} t")
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

    _issue_pass(t, truck, entry_weight, measured)
    after = usage(t.db, p.id)
    _thresholds(t, "TRIPS", after["trips"], p.trip_limit)
    if q is not None and 0 < q.remaining_trips <= max(1, int(q.max_trips * PER_VEHICLE_LOW)):
        t.alert("PER_VEHICLE_LOW", "INFO", f"{truck.plate} has {q.remaining_trips} of {q.max_trips} trips left",
                truck=truck)
    t.finish(allowed=True)


def _issue_pass(t: Trip, truck: Truck, entry_weight: float, measured: bool) -> None:
    """P1, P3, P4, P13: a trip session bound to the truck and its sticker, Ed25519-signed, with an SMS code."""
    p, m = t.permit, t.movement
    ps = t.step("Pass")
    expires = t.at + timedelta(minutes=p.pass_expiry_min)
    sess = TripSession(
        session_id=f"SES-{uuid.uuid4().hex[:12].upper()}", trip_code="pending", truck_id=truck.id,
        sticker_id=t.sticker.id, signed_token="", token_hash="", entry_gate=m.gate, entry_movement_id=m.id,
        status=OPEN, entry_at=t.at, expires_at=expires, permit_id=p.id, entry_weight_t=entry_weight,
        entry_weight_measured=measured, flags=[], source=m.source,
    )
    t.db.add(sess)
    t.db.flush()
    sess.trip_code = f"TRIP-{t.local:%Y}-{sess.id:05d}"
    sess.signed_token = passcrypto.sign(t.db, {
        "pass": sess.trip_code, "sid": sess.session_id, "permit": p.id, "plate": truck.plate,
        "fastag": truck.fastag_tag_id, "sticker": t.sticker.uid, "gate": m.gate, "issued_at": t.at.isoformat(),
        "expires_at": expires.isoformat(), "entry_weight_t": entry_weight,
    })
    sess.token_hash = hashlib.sha256(sess.signed_token.encode()).hexdigest()
    sess.sms_code = passcrypto.sms_code(t.db, sess.id)
    if t.quota is not None:  # reserve against the truck's own allocation too
        q = t.quota
        q.completed_trips += 1
        q.remaining_trips = max(0, q.max_trips - q.completed_trips)
        q.status = "EXHAUSTED" if q.remaining_trips == 0 else "LOW" if q.remaining_trips <= 5 else "AVAILABLE"
    m.pass_id = sess.id
    t.issued = t.session = sess
    ps.add("Pass issued", "passed", f"{sess.trip_code} signed (Ed25519), bound to sticker {t.sticker.uid}, "
                                    f"SMS code {sess.sms_code}, expires {expires.astimezone(IST):%H:%M}")
    t.log("PASS", "INFO", f"Pass {sess.trip_code} issued to {truck.plate}, signed, bound to sticker {t.sticker.uid}, "
                          f"SMS code {sess.sms_code}, expires {expires.astimezone(IST):%H:%M}; 1 trip reserved",
          {"pass": sess.trip_code})
    t.outbox("TRIP_SESSION_CREATED", {"session_id": sess.session_id, "trip_code": sess.trip_code,
                                      "truck_plate": truck.plate, "sticker_uid": t.sticker.uid, "entry_gate": m.gate,
                                      "entry_at": t.at.isoformat(), "expires_at": expires.isoformat()})


# ---------------------------------------------------------------- EXIT
def _find_pass(t: Trip, s: Step, truck: Truck) -> tuple[TripSession | None, str | None]:
    """The pass presented at exit (QR, SMS code, or none -> the truck's open pass). Returns (session, close_mode)."""
    db, p = t.db, t.permit
    if t.pass_token:
        payload = passcrypto.verify(db, t.pass_token)
        if payload is None:
            s.add("Signature", "failed", "QR signature invalid: forged or edited")
            t.alert("INVALID_PASS", "HIGH", "QR presented at exit has an invalid signature (forged or edited)",
                    truck=truck)
            return None, None
        sess = db.scalar(select(TripSession).where(TripSession.trip_code == payload.get("pass")))
        if sess is None or sess.permit_id != p.id:
            s.add("Signature", "failed", "QR is genuine but not for this site / permit")
            t.alert("INVALID_PASS", "HIGH", "QR presented at exit is not a pass for this permit", truck=truck)
            return None, None
        s.add("Signature", "passed", f"QR signature valid: pass {sess.trip_code}")
        return sess, "qr"
    if t.pass_code:
        code = t.pass_code.strip().upper()
        sess = db.scalar(select(TripSession).where(TripSession.permit_id == p.id, TripSession.sms_code == code))
        if sess is None:
            s.add("SMS code", "failed", f"Code {code} does not match any pass")
            t.alert("INVALID_PASS", "HIGH", f"SMS code {code} presented at exit matches no pass", truck=truck)
            return None, None
        s.add("SMS code", "passed", f"Code matches pass {sess.trip_code}")
        return sess, "sms"
    # P9: no QR or code. Close by plate + FASTag + length + sticker against the truck's open pass, limited per day.
    sess = _session_of(db, p.id, truck.id, (OPEN, *UNRESOLVED_STATUSES))
    if sess is None:
        s.add("Pass for this trip", "failed", f"None: {truck.plate} did not come through a GB entry gate, so it has "
                                              "no pass to close (passes are issued only at entry)")
        t.alert("NO_PASS", "HIGH", f"{truck.plate} at exit with no open pass (did not enter through a GB gate, "
                                   "or entered without a pass)", truck=truck)
        return None, None
    hold = _active_hold(db, p.id, truck.id)
    if hold is not None:  # a held identity may be cloned: only the QR / SMS code can close its pass
        s.add("Pass for this trip", "failed", f"No QR or SMS code shown, and {truck.plate} is on hold "
                                              f"({hold.reason_code}): only the QR or code can close its pass")
        t.alert("NO_QR_ON_HOLD", "HIGH", f"{truck.plate} at exit without QR while on hold ({hold.reason_code}); "
                                         "possible clone trying to close the real truck's pass", truck=truck, pass_=sess)
        return None, None
    day_start = t.local.replace(hour=0, minute=0, second=0, microsecond=0)
    used_today = db.scalar(select(func.count()).select_from(TripSession).where(
        TripSession.permit_id == p.id, TripSession.truck_id == truck.id, TripSession.close_mode == "no_qr",
        TripSession.completed_at >= day_start)) or 0
    if used_today >= NO_QR_CLOSES_PER_DAY:
        s.add("Pass for this trip", "failed", f"No QR or SMS code shown, and the close without QR was already used "
                                              f"today ({used_today} of {NO_QR_CLOSES_PER_DAY})")
        t.alert("NO_QR_LIMIT", "MEDIUM", f"{truck.plate} at exit without QR again today; barrier stays down until "
                                         "an officer approves", truck=truck, pass_=sess)
        return None, None
    s.add("Pass for this trip", "warning", f"No QR or SMS code shown: its open pass {sess.trip_code} matched by "
                                           "plate + FASTag + length + GB sticker")
    return sess, "no_qr"


def process_exit(t: Trip) -> None:
    ids = _identify_step(t)
    if _light_vehicle(t):
        return
    d, p, m = t.decision, t.permit, t.movement
    forced = " by a vehicle without a valid pass: counted as an ILLEGAL trip"

    if d.result not in ("AUTHORISED", "NOT_AUTHORISED"):
        _refuse_identity(t, t.step("Pass check"))
        return _exit_refused(t, forced)
    truck = d.truck
    assert truck is not None
    kind = _sticker_check(t, ids, truck)
    if kind:
        _refuse_sticker(t, ids, kind, truck)
        return _exit_refused(t, forced)
    s = t.step("Pass check")
    if d.result == "NOT_AUTHORISED":  # lapsed mid-trip: don't trap the truck, but record it
        t.alert("AUTHORISATION_LAPSED", "INFO", f"{truck.plate} is no longer authorised ({'; '.join(d.reasons)}); "
                                                "exit allowed for the trip in progress", truck=truck)

    sess, mode = _find_pass(t, s, truck)
    if sess is None:
        return _exit_refused(t, forced)
    t.session = sess

    if sess.status in (DONE, CANCELLED):  # P6
        when = f" at {sess.completed_at.astimezone(IST):%H:%M}" if sess.completed_at else ""
        msg = f"Pass {sess.trip_code} was already {'used' if sess.status == DONE else 'cancelled'}{when}"
        s.add("Not used before", "failed", msg)
        t.alert("PASS_REUSE", "HIGH", f"{msg}; presented again by {truck.plate}", truck=truck, pass_=sess)
        t.hold(truck, "PASS_REUSE")
        return _exit_refused(t, forced)
    s.add("Not used before", "passed", f"Pass {sess.trip_code} is not closed")

    if sess.truck_id != truck.id:  # P7
        msg = f"Pass {sess.trip_code} belongs to {sess.truck.plate}, presented by {truck.plate}"
        s.add("Same truck", "failed", msg)
        t.alert("PASS_MISMATCH", "HIGH", msg, truck=truck, pass_=sess)
        t.hold(truck, "PASS_MISMATCH")
        t.hold(sess.truck, "PASS_MISMATCH")
        return _exit_refused(t, forced)
    if t.sticker is not None and sess.sticker_id != t.sticker.id:
        msg = f"Pass {sess.trip_code} was issued with a different GB sticker than the one at the exit"
        s.add("Same sticker", "failed", msg)
        t.alert("RFID_MISMATCH", "HIGH", msg, truck=truck, pass_=sess)
        t.hold(truck, "RFID_MISMATCH")
        return _exit_refused(t, forced)
    s.add("Same truck", "passed", f"Pass {sess.trip_code} belongs to {truck.plate}, same GB sticker as at entry")

    if sess.status in UNRESOLVED_STATUSES or t.at > sess.expires_at:  # P11
        msg = (f"Pass {sess.trip_code} expired at {sess.expires_at.astimezone(IST):%H:%M}; exit at {t.local:%H:%M}. "
               "Officer approval needed for a late close; the trip stays counted")
        s.add("Not expired", "failed", msg)
        t.alert("PASS_EXPIRED_AT_EXIT", "MEDIUM", msg, truck=truck, pass_=sess)
        return _exit_refused(t, forced)
    s.add("Not expired", "passed", f"Valid until {sess.expires_at.astimezone(IST):%H:%M}")
    if mode == "no_qr":
        t.alert("CLOSED_WITHOUT_QR", "MEDIUM", f"{truck.plate} closed pass {sess.trip_code} without QR / code "
                                               "(plate + FASTag + length + GB sticker match)", truck=truck, pass_=sess)

    ms = t.step("Measure")  # M1, M3, M4, M5
    net = None
    if m.weight_t is None:
        ms.add("Exit weight", "failed", "No weigh pad reading: net tonnes unknown")
        t.alert("WEIGH_BYPASS", "HIGH", f"{truck.plate} exited without a weigh pad reading; load not measured",
                truck=truck, pass_=sess)
    else:
        entry_w = sess.entry_weight_t if sess.entry_weight_t is not None else truck.empty_weight_t
        net = round(m.weight_t - entry_w, 2)
        ms.add("Net load", "passed", f"{m.weight_t:.2f} t out - {entry_w:.2f} t in = {net:.2f} t")
        if net > truck.rated_capacity_t:
            over = net / truck.rated_capacity_t - 1
            sev = "HIGH" if over > OVERLOAD_HIGH_RATIO else "MEDIUM"
            ms.add("Within capacity", "warning", f"{net:.2f} t vs rated {truck.rated_capacity_t:g} t ({over:.0%} over)")
            t.alert("OVERLOAD", sev, f"{truck.plate} carrying {net:.2f} t, {over:.0%} over its rated "
                                     f"{truck.rated_capacity_t:g} t", truck=truck, pass_=sess)
        elif net < EMPTY_EXIT_T:
            ms.add("Loaded", "warning", f"Net {net:.2f} t: left empty (trip still counts)")
            t.alert("EMPTY_EXIT", "MEDIUM", f"{truck.plate} left with {net:.2f} t; the reserved trip still counts",
                    truck=truck, pass_=sess)
        else:
            ms.add("Within capacity", "passed", f"Rated {truck.rated_capacity_t:g} t")
        t.log("MEASURE", "INFO", f"Exit weight {m.weight_t:.2f} t, net {net:.2f} t")

    sess.status, sess.close_mode, sess.completed_at = DONE, mode, t.at  # P5
    sess.exit_gate, sess.exit_movement_id, sess.exit_weight_t, sess.net_t = m.gate, m.id, m.weight_t, net
    m.pass_id = sess.id
    m.counted_trip, m.trip = True, "LEGAL"
    t.log("PASS", "INFO", f"Pass {sess.trip_code} closed ({mode.replace('_', ' ')})"
                          + (f" with {net:.2f} t" if net is not None else ""), {"pass": sess.trip_code})
    t.outbox("TRIP_COMPLETED", {"session_id": sess.session_id, "trip_code": sess.trip_code, "truck_plate": truck.plate,
                                "exit_gate": m.gate, "completed_at": t.at.isoformat(), "net_t": net})

    cs = t.step("Compare")  # CP2, CP5, CP8, P15
    t.db.flush()
    u = usage(t.db, p.id)
    legal = t.db.scalar(select(func.count()).select_from(TripSession).where(TripSession.permit_id == p.id,
                                                                           TripSession.status == DONE)) or 0
    cs.add("Legal trip", "passed", f"Trip confirmed: {legal} legal of {p.trip_limit} permitted")
    cs.add("Tonnes", "passed", f"{u['tonnes']:.1f} of {p.tonne_limit:g} t")
    t.quota = _vehicle_quota(t, truck)
    if t.quota is not None:
        cs.add("Vehicle allocation", "passed", f"{t.quota.completed_trips} of {t.quota.max_trips} trips used by {truck.plate}")
    t.log("COMPARE", "INFO", f"Legal trips {legal}/{p.trip_limit}, tonnes {u['tonnes']:.1f}/{p.tonne_limit:g}")
    _thresholds(t, "TONNES", u["tonnes"], p.tonne_limit)
    end = datetime.combine(t.local.date(), p.hours_end, tzinfo=IST) + timedelta(minutes=p.exit_grace_min)
    if t.local > end:
        msg = f"Exit at {t.local:%H:%M}, after hours end {p.hours_end:%H:%M} + {p.exit_grace_min} min grace"
        cs.add("Working hours", "warning", msg)
        t.alert("OUTSIDE_HOURS", "MEDIUM", msg, truck=truck, pass_=sess)
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
        t.outbox("ILLEGAL_TRIP", {"movement_id": m.id, "gate": m.gate, "plate": m.plate_normalised})


class OfficerActionError(Exception):
    """An officer action that does not apply to this movement (the message says why)."""


def officer_exit(db: Session, refused: Movement, officer_name: str, reason: str, at: datetime) -> Trip:
    """A2 / P11 at the gate: an officer checks a truck whose exit was refused and lets it out. The truck's own
    pass is closed by the officer (close_mode "officer", flagged), so the trip stays counted as legal. Not allowed
    while the truck is on hold (release the hold first), for an unidentified vehicle, or with no pass to close."""
    if refused.direction != "OUT" or refused.decision != "REFUSED":
        raise OfficerActionError("Only a refused exit can be let out by an officer")
    if refused.barrier_forced:
        raise OfficerActionError("The vehicle already forced the barrier: nothing to let out")
    if refused.truck_id is None or refused.permit_id is None:
        raise OfficerActionError("Vehicle not identified: it cannot be let out against a pass; escalate instead")
    if "OFFICER_EXIT_DONE" in (refused.flags or []):
        raise OfficerActionError("This refused exit was already handled by an officer")
    permit, truck = db.get(Permit, refused.permit_id), db.get(Truck, refused.truck_id)
    hold = _active_hold(db, permit.id, truck.id)
    if hold is not None:
        raise OfficerActionError(f"{truck.plate} is on hold ({hold.reason_code}): release the hold first")
    sess = _session_of(db, permit.id, truck.id, (OPEN, *UNRESOLVED_STATUSES))
    if sess is None:
        raise OfficerActionError(f"{truck.plate} has no open pass to close: it did not enter through a GB gate. "
                                 "Keep it at the barrier and escalate")

    m = Movement(gate=refused.gate, direction="OUT", observed_at=at, plate_read=refused.plate_read,
                 plate_normalised=refused.plate_normalised, fastag_read=refused.fastag_read,
                 radar_length_m=refused.radar_length_m, rfid_sticker_uid=refused.rfid_sticker_uid,
                 result=refused.result, truck_id=truck.id, identify_mode="officer", checks=[], caught_by=[],
                 reasons=[], flags=["OFFICER_EXIT"], source=refused.source, permit_id=permit.id,
                 weight_t=refused.weight_t, barrier_forced=False)
    db.add(m)
    db.flush()
    refused.flags = [*(refused.flags or []), "OFFICER_EXIT_DONE"]
    t = Trip(db, permit, m, Decision(refused.result, truck, refused.plate_normalised), [], session=sess)

    s = t.step("Officer exit")
    s.add("Refused exit", "info", f"Exit #{refused.id} at {refused.observed_at.astimezone(IST):%H:%M} was refused")
    s.add("Officer check", "warning", f"{officer_name} checked {truck.plate} and let it out: {reason}")
    s.add("Pass closed by officer", "warning", f"Pass {sess.trip_code} ({sess.status}) closed by the officer; "
                                               "the trip counts as legal and is flagged for review")
    net = None
    if m.weight_t is not None:
        entry_w = sess.entry_weight_t if sess.entry_weight_t is not None else truck.empty_weight_t
        net = round(m.weight_t - entry_w, 2)
        t.step("Measure").add("Net load", "passed", f"{m.weight_t:.2f} t out - {entry_w:.2f} t in = {net:.2f} t")
    else:
        t.step("Measure").add("Exit weight", "failed", "No weigh pad reading: net tonnes unknown")
    sess.status, sess.close_mode, sess.completed_at = DONE, "officer", at
    sess.exit_gate, sess.exit_movement_id, sess.exit_weight_t, sess.net_t = m.gate, m.id, m.weight_t, net
    sess.flags = [*(sess.flags or []), "OFFICER_EXIT"]
    sess.notes = f"Let out at the gate by {officer_name}: {reason}"
    m.pass_id = sess.id
    m.counted_trip, m.trip = True, "LEGAL"
    t.alert("OFFICER_EXIT", "MEDIUM", f"{truck.plate} let out by officer {officer_name} after a refused exit "
                                      f"(pass {sess.trip_code} closed by the officer): {reason}", truck=truck, pass_=sess)
    t.log("PASS", "INFO", f"Pass {sess.trip_code} closed by officer {officer_name}"
                          + (f" with {net:.2f} t" if net is not None else ""), {"pass": sess.trip_code})
    t.outbox("TRIP_COMPLETED", {"session_id": sess.session_id, "trip_code": sess.trip_code, "truck_plate": truck.plate,
                                "exit_gate": m.gate, "completed_at": at.isoformat(), "net_t": net, "officer": True})
    t.finish(allowed=True)
    return t


def process(t: Trip) -> None:
    if t.movement.direction == "IN":
        process_entry(t)
    else:
        process_exit(t)


# ---------------------------------------------------------------- ledger (Compare, for dashboards)
def ledger(db: Session, permit: Permit) -> dict:
    u = usage(db, permit.id)
    count = lambda *w: db.scalar(select(func.count()).select_from(TripSession).where(  # noqa: E731
        TripSession.permit_id == permit.id, *w)) or 0
    legal, open_ = count(TripSession.status == DONE), count(TripSession.status == OPEN)
    unresolved = count(TripSession.status.in_(UNRESOLVED_STATUSES))
    actual = db.scalar(select(func.count()).select_from(Movement).where(Movement.permit_id == permit.id,
                                                                        Movement.counted_trip.is_(True))) or 0
    illegal = db.scalar(select(func.count()).select_from(Movement).where(Movement.permit_id == permit.id,
                                                                         Movement.trip == "ILLEGAL")) or 0
    holds = db.scalar(select(func.count()).select_from(TruckHold).where(TruckHold.permit_id == permit.id,
                                                                        TruckHold.released_at.is_(None))) or 0
    sev = dict(db.execute(select(Alert.severity, func.count()).where(Alert.permit_id == permit.id)
                          .group_by(Alert.severity)).all())
    from app.models import EmergencyMovement  # local: edge models are optional for the pipeline itself

    provisional = db.scalar(select(func.count()).select_from(EmergencyMovement)
                            .where(EmergencyMovement.reconciled.is_(False))) if permit.source is None else 0
    return {
        "permit_id": permit.id,
        "trip_limit": permit.trip_limit,
        "tonne_limit": permit.tonne_limit,
        "vehicle_limit": permit.vehicle_limit,
        "per_vehicle_trips": permit.per_vehicle_trips,
        "trips_reserved": u["trips"],
        "legal_trips": legal,
        "open_passes": open_,
        "unresolved_passes": unresolved,
        "actual_trips": actual,
        "illegal_trips": illegal,
        "tonnes": round(u["tonnes"], 2),
        "vehicles": len(u["truck_ids"]),
        "active_holds": holds,
        "provisional_emergency_movements": provisional or 0,  # CP11: not yet reconciled
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

    for m in db.scalars(select(Movement).where(Movement.permit_id == permit.id)).all():
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
    for sess in db.scalars(select(TripSession).where(TripSession.permit_id == permit.id,
                                                     TripSession.status == DONE)).all():
        if sess.completed_at is not None and sess.net_t is not None:
            day(sess.completed_at.astimezone(IST).date())["tonnes"] += sess.net_t
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
