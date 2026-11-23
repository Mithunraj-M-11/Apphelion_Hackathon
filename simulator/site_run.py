"""Site-level simulation: a whole contract period played through the GB gates, then a site report.

    python run.py site <scenario>        -> scenarios/site/<scenario>.yaml

The generator simulates every truck's days and keeps GROUND TRUTH (every load that really left the site, its true
tonnes, and which ones were cheats). It plays the resulting gate events, in time order, through the same gate API a
real pole uses; the GB never sees the ground truth. Each truck and each injected cheat is a small script (a Python
generator) that yields the next physical arrival at a barrier and reacts to the GB's real answer (pass issued,
barrier up / down). At the end of each site day the Vendor files its own report (CP9) and a simulated GB officer
reviews and releases that day's holds. The report compares Permit allows / Vendor says / With a valid pass /
Counted at GB gates / Without a pass / Really left (ground truth), and scores every cheat as prevented, detected or
missed.

Everything is deterministic for a given seed. The registry is never written to.
"""

import heapq
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import httpx
import yaml

import pole

IST = timezone(timedelta(hours=5, minutes=30))
SITE_DIR = Path(__file__).parent / "scenarios" / "site"
SERIOUS = ("HIGH", "CRITICAL")
PERMIT_WARNINGS = ("TRIPS_", "TONNES_")  # permit-level, not about a truck: never a false alarm
# about the GB's own equipment (a pole, the pad, the link), raised on whichever truck arrives next: never a false
# alarm on that truck
EQUIPMENT_ALERTS = ("POLE_SILENT", "LATE_EVENT", "WEIGH_DRIFT", "LOAD_DROP", "WIM_UNAVAILABLE", "WIM_PAD_DISAGREE")
GATE = "G1"

# Vehicles that are NOT in the registry (made-up test data)
OUTSIDERS = ["OD09ZX7781", "OD14QQ0042", "OD11MM5521", "OD02KK7310", "OD05TT6612", "OD19HB3021"]
OUTSIDE_TAG = "34161FA80000000000{:04d}OUT"


@dataclass
class Veh:
    label: str
    plate: str | None
    tag: str | None
    length: float
    empty: float
    rated: float
    sticker: str | None = None  # GB RFID sticker UID (registered trucks)
    spacings: list[float] | None = None  # axle spacings of the real body (m), what the WIM strip measures


@dataclass
class Cheat:
    type: str
    day: str
    at: str
    vehicle: str
    on_refusal: str | None = None
    outcome: str = "missed"  # prevented | detected | missed
    attempt_flagged: bool = False  # missed, but the GB has a refusal / alert for the attempt
    alerts: list[str] = field(default_factory=list)
    first_alert_min: float | None = None
    note: str = ""
    movements: list[int] = field(default_factory=list)  # the GB gate events of this attempt
    timeline: list[dict] = field(default_factory=list)  # every leg in order: gate events (seen) and the rest (unseen)
    _start: datetime | None = None

    def gate(self, resp: dict, at: datetime, who: str | None = None) -> None:
        """A gate event that belongs to this story (seen by the GB). `who` names the vehicle when the plate read
        doesn't (the real truck vs its copy)."""
        if resp.get("id") is not None and resp["id"] not in self.movements:
            self.movements.append(resp["id"])
            self.timeline.append({"at": at.strftime("%H:%M"), "seen": True, "movement": resp["id"],
                                  "text": gate_line(resp, who), "alerts": alert_codes(resp)})

    def off(self, at: datetime, text: str) -> None:
        """A leg the GB cannot see (side track, loading inside the site, ...)."""
        self.timeline.append({"at": at.strftime("%H:%M"), "seen": False, "text": text})

    def saw(self, resp: dict, at: datetime, who: str | None = None) -> list[str]:
        self.gate(resp, at, who)
        codes = [a["code"] for a in resp["alerts"] if not a["code"].startswith(PERMIT_WARNINGS)]
        if codes and self.first_alert_min is None and self._start is not None:
            self.first_alert_min = round((at - self._start).total_seconds() / 60, 1)
        self.alerts += [c for c in codes if c not in self.alerts]
        return codes

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if not k.startswith("_")}


def alert_codes(resp: dict) -> list[str]:
    return [a["code"] for a in resp.get("alerts", []) if not a["code"].startswith(PERMIT_WARNINGS)]


def gate_line(resp: dict, who: str | None = None) -> str:
    """One gate event in plain words: where, who / what was read, what the GB decided."""
    entry = resp.get("direction") == "IN"
    where = f"{'Entry' if entry else 'Exit'} gate {resp.get('gate', GATE)}"
    read = resp.get("plate_read") or "no plate"
    read = f"{who}, plate read {read}" if who else read
    if resp.get("barrier") == "up":
        if entry:
            issued = (resp.get("issued_pass") or {}).get("code")
            what = f"let in, pass {issued} issued" if issued else "let through"
        else:
            what = f"let out, {resp['trip'].lower()} trip" if resp.get("trip") else "let out"
    else:
        what = "barrier stays down"
        if resp.get("barrier_forced"):
            what += ", broke through" + (": illegal trip" if resp.get("trip") == "ILLEGAL" else "")
    return f"{where}: {'' if who else 'read '}{read}, {what}"


@dataclass
class Ev:
    """A vehicle physically arriving at a barrier."""
    at: datetime
    dir: str
    veh: Veh
    weight: float | None
    plate_shown: str | None = "own"
    tag: str | None = "own"
    token: str | None = None
    code: str | None = None
    forced: bool = False
    honest: bool = True
    rfid: str = "genuine"  # what the GB sticker's challenge-response shows: genuine | cloned | ...
    resp: dict | None = None
    misread: bool = False  # staging: a sensor missed this read


class World:
    def __init__(self, cfg: dict, client: httpx.Client, registry: dict[str, dict]):
        self.cfg = cfg
        stickers = client.get("/api/rfid-stickers").raise_for_status().json()
        self.stickers = {x["truck"]["plate"]: x["uid"] for x in stickers if x.get("truck") and x["status"] == "ACTIVE"}
        self.client = client
        self.rng = random.Random(cfg.get("seed", 1))
        self.days: list[date] = []
        n = cfg.get("days", 7)
        start = cfg.get("start")
        first = date.fromisoformat(start) if start else datetime.now(IST).date() - timedelta(days=n - 1)
        self.days = [first + timedelta(days=i) for i in range(n)]
        p = cfg["permit"]
        self.hours_start = time.fromisoformat(p.get("hours_start", "06:00"))
        self.hours_end = time.fromisoformat(p.get("hours_end", "18:00"))
        self.honest_cfg = {"loading_min": [30, 60], "haul_min": [120, 240], "load_pct": [80, 95],
                           "weigh_noise_t": 0.15, "dead_phone_rate": 0.0, "late_exit_rate": 0.0,
                           **cfg.get("honest", {})}
        self.truth: list[dict] = []
        self.cheats: list[Cheat] = []
        self.events: list[Ev] = []
        self.unexpected: list[str] = []
        self.skipped: list[str] = []
        self.last_token: str | None = None
        self.vendor: list[dict] = []
        self.vendor_cum = 0
        self.passes_issued = 0

        authorised = sorted(pl for pl, t in registry.items()  # working trucks: authorised, active GB sticker
                            if t["authorisation"]["authorised"] and pl in self.stickers)
        self.rng.shuffle(authorised)
        size = min(cfg.get("fleet", 12), len(authorised))
        self.fleet = [self.veh(registry[pl]) for pl in authorised[:size]]
        self.pool = [self.veh(registry[pl]) for pl in authorised[size:]]
        self.pool_free: dict[str, datetime] = {v.label: datetime.min.replace(tzinfo=IST) for v in self.pool}
        self.outsider_i = 0

        # staging: pole outages (fixed by the seed), weigh pad drift, sensor misses on honest trucks
        self.outages: list[tuple[datetime, datetime]] = []
        oc = cfg.get("outages")
        if oc:
            n = int(oc.get("per_week", 2) * len(self.days) / 7 + 0.5)
            for d in self.rng.sample(self.days, min(n, len(self.days))):
                start = self.at(d, self.hours_start, self.u(60, 480))
                self.outages.append((start, start + timedelta(minutes=self.u(*oc.get("minutes", [30, 90])))))
            self.outages.sort()
        self.drift = cfg.get("weigh_drift")  # {from_day: 4, offset_t: -3}: loaded readings off from that day
        self.noise_cfg = cfg.get("sensor_noise", {})  # {plate_miss: 0.03, fastag_miss: 0.02} on honest reads
        self.misread_refusals = 0
        self.reference_tests: list[dict] = []
        self.surveys: list[dict] = []
        self.model_errors: list[float] = []  # per terrain model, in tonnes
        self.survey_rng = random.Random(cfg.get("seed", 1) + 99)  # its own stream: surveys don't change the run
        self.wim_rng = random.Random(cfg.get("seed", 1) + 77)  # WIM noise and faults: their own stream too
        self.wim_cfg = cfg.get("wim_noise", {})  # {poor: 0.03, offline: 0.01}: share of crossings
        self.waits_for_outage = 0

    # ---- helpers
    def veh(self, t: dict) -> Veh:
        return Veh(t["plate"], t["plate"], t["fastag_tag_id"], t["length_m"], t["empty_weight_t"], t["rated_capacity_t"],
                   self.stickers.get(t["plate"]), t.get("axle_spacings_m"))

    def outsider(self) -> Veh:
        i = self.outsider_i
        self.outsider_i += 1
        return Veh(f"outsider {OUTSIDERS[i % len(OUTSIDERS)]}", OUTSIDERS[i % len(OUTSIDERS)], OUTSIDE_TAG.format(i),
                   round(self.rng.uniform(7.8, 9.6), 2), 12.0, 25.0,
                   spacings=[round(self.wim_rng.uniform(3.5, 4.1), 2), 1.35])

    def at(self, d: date, t: time, plus_min: float = 0) -> datetime:
        return datetime.combine(d, t, tzinfo=IST) + timedelta(minutes=plus_min)

    def u(self, lo: float, hi: float) -> float:
        return self.rng.uniform(lo, hi)

    def noise(self) -> float:
        n = self.honest_cfg["weigh_noise_t"]
        return self.rng.uniform(-n, n)

    def w(self, v: Veh, load_t: float) -> float:
        return round(v.empty + load_t + self.noise(), 2)

    def choose(self, spec) -> str:
        if spec is None or isinstance(spec, str):
            return spec or "turn_back"
        r, acc = self.rng.random(), 0.0
        for k, p in spec.items():
            acc += p
            if r < acc:
                return k
        return list(spec)[-1]

    def trip(self, at: datetime, v: Veh, tonnes: float, kind: str, crossed_gate: bool, cheat: str | None = None,
             cause: str | None = None):
        """A trip that really happened. `crossed_gate` = a GB pole saw it leave; `cause` says why it went unseen
        (side track, pole down, light vehicle)."""
        if cause is None and not crossed_gate:
            cause = "side track"
        self.truth.append({"day": at.date().isoformat(), "at": at.strftime("%H:%M"), "vehicle": v.label,
                           "tonnes": round(tonnes, 2), "kind": kind, "cheat": cheat, "crossed_gate": crossed_gate,
                           "cause": cause})

    # ---- staging (threat_week): faults and attacks that are not a truck at a gate
    def down(self, t: datetime) -> tuple[datetime, datetime] | None:
        """The pole outage window covering t, if any (power cut, smashed pole)."""
        return next(((a, b) for a, b in self.outages if a <= t < b), None)

    def drop(self, c: Cheat, why: str) -> None:
        """The trick could not be staged (e.g. its test truck was refused for an unrelated reason): not scored."""
        self.cheats.remove(c)
        self.skipped.append(f"{c.type} on {c.day} {c.at} ({c.vehicle}): {why}")

    def cheat(self, type_: str, start: datetime, v: Veh, on_refusal: str | None = None) -> Cheat:
        c = Cheat(type_, start.date().isoformat(), start.strftime("%H:%M"), v.label, on_refusal, _start=start)
        self.cheats.append(c)
        return c


def down(resp: dict) -> bool:
    return resp["barrier"] == "down"


# ================================================================ actors
def honest_truck(w: World, v: Veh):
    """A truck doing honest work all period. After the trip quota is used up, the Vendor decides what it does
    (permit.after_quota): turn back, force the barrier, or go round by a side track (that part is cheating)."""
    hc = w.honest_cfg
    after_quota = w.cfg.get("after_quota")
    for d in w.days:
        t = w.at(d, w.hours_start, w.u(0, 75))
        dead_phone_used = False
        last_entry = w.at(d, w.hours_end, -60)
        while t <= last_entry:
            behaviour = w.choose(after_quota) if after_quota else "turn_back"
            quota_full = w.passes_issued >= w.cfg["permit"]["trip_limit"]
            ev = Ev(t, "IN", v, w.w(v, 0), forced=(behaviour == "force" and quota_full))
            r = yield ev
            if down(r):
                codes = [a["code"] for a in r["alerts"]]
                if "TRIP_LIMIT" in codes or "TONNE_LIMIT" in codes:
                    ev.honest = False
                    c = w.cheat("quota_push", t, v, behaviour)
                    c.saw(r, t)
                    load_min, load_t = w.u(*hc["loading_min"]), v.rated * w.u(*hc["load_pct"]) / 100
                    if behaviour == "turn_back":
                        c.outcome, c.note = "prevented", "turned back at the entry barrier, empty"
                        c.off(t + timedelta(minutes=2), "turned back empty")
                        t += timedelta(minutes=w.u(*hc["haul_min"]))
                    elif behaviour == "force":
                        c.off(t + timedelta(minutes=5), "loaded inside the site with no pass")
                        out = Ev(t + timedelta(minutes=load_min), "OUT", v, w.w(v, load_t), forced=True, honest=False)
                        r2 = yield out
                        c.saw(r2, out.at)
                        w.trip(out.at, v, load_t, "cheat", True, "quota_push")
                        c.outcome, c.note = "detected", "forced both barriers"
                        t = out.at + timedelta(minutes=w.u(*hc["haul_min"]))
                    else:  # side track in and out
                        out_at = t + timedelta(minutes=load_min)
                        c.off(t + timedelta(minutes=5), "went round: came in by a side track and loaded")
                        c.off(out_at, "left loaded by a side track")
                        w.trip(out_at, v, load_t, "cheat", False, "quota_push")
                        c.outcome, c.attempt_flagged = "missed", True
                        c.note = "refused at entry, then went round by a side track"
                        t = out_at + timedelta(minutes=w.u(*hc["haul_min"]))
                    continue
                if ev.misread:  # a sensor missed it: the honest truck is refused, waits, and tries again
                    w.misread_refusals += 1
                    t += timedelta(minutes=10)
                    continue
                ev.honest = False
                w.unexpected.append(f"{t:%d %b %H:%M} {v.label} refused at entry: {codes}")
                t += timedelta(minutes=60)
                continue
            p = r["issued_pass"]
            w.passes_issued += 1
            w.last_token = p["token"]
            load_t = v.rated * w.u(*hc["load_pct"]) / 100
            exit_at = t + timedelta(minutes=w.u(*hc["loading_min"]))
            if t >= w.at(d, w.hours_end, -75) and w.rng.random() < hc["late_exit_rate"]:
                exit_at = t + timedelta(minutes=110)  # last load of the day runs late
            dead = not dead_phone_used and w.rng.random() < hc["dead_phone_rate"]
            dead_phone_used = dead_phone_used or dead
            out = Ev(exit_at, "OUT", v, w.w(v, load_t), token=None if dead else p["token"])
            r2 = yield out
            tries = 0
            while down(r2) and out.misread and tries < 3:  # misread at the exit: re-read a few minutes later
                w.misread_refusals += 1
                tries += 1
                exit_at = out.at + timedelta(minutes=5)
                out = Ev(exit_at, "OUT", v, w.w(v, load_t), token=None if dead else p["token"])
                r2 = yield out
            if down(r2):
                w.unexpected.append(f"{exit_at:%d %b %H:%M} {v.label} refused at exit: {[a['code'] for a in r2['alerts']]}")
            else:
                w.trip(exit_at, v, load_t, "legal", True)
            t = exit_at + timedelta(minutes=w.u(*hc["haul_min"]))


def _leave_after_refusal(w: World, c: Cheat, ev: Ev, r: dict, v: Veh, load_t: float):
    """The vehicle at a closed exit barrier, loaded, does what the Vendor told it to (on_refusal)."""
    if not down(r):
        w.trip(ev.at, v, load_t, "cheat", True, c.type)
        c.outcome, c.note = "missed", "barrier lifted"
        return
    if c.on_refusal == "force":
        w.trip(ev.at, v, load_t, "cheat", True, c.type)
        c.outcome, c.note = "detected", "forced the exit barrier"
    elif c.on_refusal == "side_track":
        w.trip(ev.at + timedelta(minutes=10), v, load_t, "cheat", False, c.type)
        c.off(ev.at + timedelta(minutes=10), "turned round and left loaded by a side track")
        c.outcome, c.note = "detected", "refused at exit, then left by a side track"
    else:
        c.off(ev.at + timedelta(minutes=5), "stayed inside; the load stays on site")
        c.outcome, c.note = "prevented", "refused at exit; load stayed on site"


def _refused_at_entry(w: World, c: Cheat, ev: Ev, r: dict, v: Veh, who: str | None = None):
    """A vehicle refused at the entry barrier does what the Vendor told it to."""
    load_t = v.rated * w.u(85, 95) / 100
    load_min = w.u(30, 60)
    if not down(r):
        out = Ev(ev.at + timedelta(minutes=load_min), "OUT", v, w.w(v, load_t),
                 token=(r.get("issued_pass") or {}).get("token"), honest=False)
        r2 = yield out
        c.saw(r2, out.at)
        if not down(r2):
            w.trip(out.at, v, load_t, "cheat", True, c.type)
            c.outcome, c.note = "missed", "was let in and out"
        return
    if c.on_refusal == "force":
        c.off(ev.at + timedelta(minutes=5), "loaded inside the site with no pass")
        out = Ev(ev.at + timedelta(minutes=load_min), "OUT", v, w.w(v, load_t), forced=True, honest=False,
                 plate_shown=ev.plate_shown, tag=ev.tag, rfid=ev.rfid)
        r2 = yield out
        c.saw(r2, out.at, who)
        w.trip(out.at, v, load_t, "cheat", True, c.type)
        c.outcome, c.note = "detected", "forced the entry and the exit barrier"
    elif c.on_refusal == "side_track":
        w.trip(ev.at + timedelta(minutes=load_min), v, load_t, "cheat", False, c.type)
        c.off(ev.at + timedelta(minutes=5), "went round: came in by a side track and loaded")
        c.off(ev.at + timedelta(minutes=load_min), "left loaded by a side track")
        c.outcome, c.attempt_flagged = "missed", True
        c.note = "refused at entry, then went round by a side track"
    else:
        c.off(ev.at + timedelta(minutes=2), "turned back empty")
        c.outcome, c.note = "prevented", "turned back at the entry barrier, empty"


def cheat_actor(w: World, type_: str, start: datetime, v: Veh, on_refusal: str, other: Veh | None):
    c = w.cheat(type_, start, v, on_refusal)
    load = lambda veh: veh.rated * w.u(85, 95) / 100  # noqa: E731
    mins = lambda lo, hi: timedelta(minutes=w.u(lo, hi))  # noqa: E731

    if type_ in ("unregistered", "night_trip"):
        ev = Ev(start, "IN", v, w.w(v, 0), forced=(on_refusal == "force"), honest=False)
        r = yield ev
        c.saw(r, ev.at)
        yield from _refused_at_entry(w, c, ev, r, v)

    elif type_ == "clone":  # the real truck is inside with an open pass; a same-size copy arrives
        r = yield Ev(start, "IN", v, w.w(v, 0))
        c.gate(r, start, "the real truck")
        if down(r):
            return w.drop(c, f"real truck refused ({[a['code'] for a in r['alerts']]})")
        p = r["issued_pass"]
        # same plate, cloned FASTag, same size, and a copied sticker UID: it cannot answer the challenge-response
        twin = Veh(f"clone of {v.plate}", v.plate, v.tag, round(v.length + 0.1, 2), 12.0, v.rated, v.sticker, v.spacings)
        ev = Ev(start + mins(10, 25), "IN", twin, w.w(twin, 0), forced=(on_refusal == "force"), honest=False,
                rfid="cloned")
        r = yield ev
        c.saw(r, ev.at, "the copy")
        yield from _refused_at_entry(w, c, ev, r, twin, "the copy")
        out_at = max(ev.at, start) + mins(20, 40)
        load_t = load(v)
        r = yield Ev(out_at, "OUT", v, w.w(v, load_t), token=p["token"])
        c.gate(r, out_at, "the real truck")
        if not down(r):
            w.trip(out_at, v, load_t, "legal", True)

    elif type_ == "pass_reuse":
        r = yield Ev(start, "IN", v, w.w(v, 0))
        c.gate(r, start)
        if down(r):
            return w.drop(c, f"refused at entry ({[a['code'] for a in r['alerts']]})")
        p = r["issued_pass"]
        out_at, load_t = start + mins(30, 60), load(v)
        r = yield Ev(out_at, "OUT", v, w.w(v, load_t), token=p["token"])
        c.gate(r, out_at)
        if not down(r):
            w.trip(out_at, v, load_t, "legal", True)
        again = out_at + mins(90, 150)  # came back in by a side track, reloaded
        c.off(again - timedelta(minutes=40), "came back in by a side track and loaded again, keeping the old QR")
        load_t = load(v)
        ev = Ev(again, "OUT", v, w.w(v, load_t), token=p["token"], forced=(on_refusal == "force"), honest=False)
        r = yield ev
        c.saw(r, ev.at)
        _leave_after_refusal(w, c, ev, r, v, load_t)

    elif type_ == "pass_handover":
        r = yield Ev(start, "IN", v, w.w(v, 0))
        c.gate(r, start)
        if down(r) or other is None:
            return w.drop(c, f"refused at entry ({[a['code'] for a in r['alerts']]})")
        p = r["issued_pass"]
        c.vehicle = f"{other.label} with the pass of {v.label}"
        c.off(start + mins(5, 15), f"{v.label} hands its QR to {other.label}, which came in by a side track and loaded")
        load_t = load(other)
        ev = Ev(start + mins(30, 50), "OUT", other, w.w(other, load_t), token=p["token"],
                forced=(on_refusal == "force"), honest=False)
        r = yield ev
        c.saw(r, ev.at, f"{other.label} showing the QR of {v.label}")
        _leave_after_refusal(w, c, ev, r, other, load_t)
        out_at, load_t = ev.at + mins(10, 30), load(v)
        r = yield Ev(out_at, "OUT", v, w.w(v, load_t), token=p["token"], honest=False)  # phone handed back
        c.saw(r, out_at)
        if not down(r):
            w.trip(out_at, v, load_t, "legal", True)

    elif type_ == "forged_qr":
        token = w.last_token or "eyJwYXNzIjoiUC0wMDAxIn0.c2lnbmF0dXJl"
        body, sig = token.split(".")
        i = len(body) // 2
        forged = f"{body[:i]}{'B' if body[i] == 'A' else 'A'}{body[i + 1:]}.{sig}"
        load_t = load(v)
        c.off(start - timedelta(minutes=40), "came in by a side track and loaded, carrying an edited copy of a QR")
        ev = Ev(start, "OUT", v, w.w(v, load_t), token=forged, forced=(on_refusal == "force"), honest=False)
        r = yield ev  # came in by a side track
        c.saw(r, ev.at)
        _leave_after_refusal(w, c, ev, r, v, load_t)

    elif type_ == "side_track_in_gate_out":
        load_t = load(v)
        c.off(start - timedelta(minutes=40), "came in by a side track: no entry gate, so no pass")
        c.off(start - timedelta(minutes=20), "loaded inside the site")
        ev = Ev(start, "OUT", v, w.w(v, load_t), forced=(on_refusal == "force"), honest=False)
        r = yield ev
        c.saw(r, ev.at)
        _leave_after_refusal(w, c, ev, r, v, load_t)

    elif type_ == "side_track_both":
        c.off(start, "came in by a side track")
        c.off(start + timedelta(minutes=30), "left loaded by a side track: never at a GB gate")
        w.trip(start + mins(30, 60), v, load(v), "cheat", False, type_)
        c.outcome, c.note = "missed", "never crossed a GB gate (only the monthly mass balance, CP10, would show it)"
        return
        yield  # noqa: unreachable; makes this a generator

    elif type_ == "side_track_out":
        r = yield Ev(start, "IN", v, w.w(v, 0))
        c.gate(r, start)
        if down(r):
            return w.drop(c, f"refused at entry ({[a['code'] for a in r['alerts']]})")
        load_t = load(v)
        c.off(start + timedelta(minutes=40), "loaded and left by a side track: its pass stays open")
        w.trip(start + mins(30, 60), v, load_t, "cheat", False, type_)  # left by a side track; pass stays open
        back = start + mins(180, 260)
        ev = Ev(back, "IN", v, w.w(v, 0), honest=False)
        r = yield ev  # next trip: the open pass gives it away
        c.saw(r, ev.at)
        c.outcome = "detected" if c.alerts else "missed"
        c.note = "left by a side track; caught when it came back with its pass still open"

    elif type_ in ("overload", "arrive_loaded", "weigh_bypass"):
        extra_in = w.u(6, 10) if type_ == "arrive_loaded" else 0
        if type_ == "arrive_loaded":
            c.off(start - timedelta(minutes=30), "picked up material outside the site")
        r = yield Ev(start, "IN", v, w.w(v, extra_in), honest=False)
        if down(r):
            return w.drop(c, f"refused at entry ({[a['code'] for a in r['alerts']]})")
        c.saw(r, start)
        p = r["issued_pass"]
        load_t = v.rated * (w.u(118, 135) if type_ == "overload" else w.u(85, 95)) / 100
        out_at = start + mins(30, 60)
        weight = None if type_ == "weigh_bypass" else w.w(v, load_t + extra_in)
        c.off(out_at - timedelta(minutes=15), {"overload": "loaded well above its rated capacity",
                                               "arrive_loaded": "loaded on top of what it brought in",
                                               "weigh_bypass": "loaded, then drove round the exit weigh pad"}[type_])
        r = yield Ev(out_at, "OUT", v, weight, token=p["token"], honest=False)
        c.saw(r, out_at)
        w.trip(out_at, v, load_t, "legal", True, type_)
        expected = {"overload": "OVERLOAD", "arrive_loaded": "ARRIVED_LOADED", "weigh_bypass": "WEIGH_BYPASS"}[type_]
        c.outcome = "detected" if expected in c.alerts else "missed"
        c.note = {"overload": "load above rated capacity", "arrive_loaded": "brought material in from outside",
                  "weigh_bypass": "drove round the weigh pad"}[type_]
    elif type_ == "transplant":  # X's real plate, FASTag and GB sticker moved onto the Vendor's extra truck
        other = [round(v.spacings[0] - 0.3, 2), *v.spacings[1:]] if v.spacings else None  # another model's chassis
        body = Veh(f"extra truck wearing {v.label}'s identity", v.plate, v.tag, round(v.length + 0.04, 2),
                   round(v.empty + w.u(0.5, 0.8), 2), v.rated, v.sticker, other)
        c.off(start - timedelta(minutes=30), f"{v.label}'s plate, FASTag and GB sticker moved onto an extra truck")
        r = yield Ev(start, "IN", body, w.w(body, 0), honest=False)
        c.saw(r, start, "the extra truck")
        if down(r):
            c.outcome, c.note = "prevented", "refused at entry"
            return
        p = r["issued_pass"]
        out_at, load_t = start + mins(30, 60), load(body)
        r = yield Ev(out_at, "OUT", body, w.w(body, load_t), token=p["token"], honest=False)
        c.saw(r, out_at, "the extra truck")
        if not down(r):
            w.trip(out_at, body, load_t, "cheat", True, type_)
        c.outcome = "detected" if c.alerts else "missed"
        c.note = "worked as " + v.label + (": flagged" if c.alerts else ", nothing noticed")

    elif type_ == "officer_cover":  # a bribed officer hides a side-route trip
        r = yield Ev(start, "IN", v, w.w(v, 0))
        c.gate(r, start)
        if down(r):
            return w.drop(c, f"refused at entry ({[a['code'] for a in r['alerts']]})")
        load_t = load(v)
        side = start + mins(30, 50)
        c.off(side, "left loaded by a side track; its pass stays open")
        w.trip(side, v, load_t, "cheat", False, type_)
        back = start + mins(170, 230)  # past the pass expiry: the next entry is refused
        ev = Ev(back, "IN", v, w.w(v, 0), honest=False)
        r = yield ev
        c.saw(r, back)
        if down(r) and w.bribed_officer:
            trips = w.client.get("/api/trips", params={"permit_id": w.permit_id,
                                                       "status": "ACTIVE,EXPIRED_UNRESOLVED,FLAGGED"}).json()
            mine = [x for x in trips if (x.get("truck") or {}).get("plate") == v.plate]
            if mine:
                w.client.post(f"/api/trips/{mine[0]['session_id']}/resolve",
                              headers={"X-Officer-Id": str(w.bribed_officer)},
                              params={"action": "RESOLVE", "reason": "Truck left by the gate; sensor fault"})
                c.off(back + timedelta(minutes=5), "a bribed officer late-closes the open trip as 'sensor fault'")
                c.attempt_flagged = True
                r = yield Ev(back + timedelta(minutes=10), "IN", v, w.w(v, 0))
                c.gate(r, back + timedelta(minutes=10))
                if not down(r):
                    out_at, lt = back + mins(40, 60), load(v)
                    r2 = yield Ev(out_at, "OUT", v, w.w(v, lt), token=r["issued_pass"]["token"])
                    c.gate(r2, out_at)
                    if not down(r2):
                        w.trip(out_at, v, lt, "legal", True)
        c.outcome = "missed"
        c.note = "side-route trip covered up by a bribed officer's late close"

    elif type_ == "light_vehicle":  # a pickup under 6 m carries about a tonne, logged but not counted
        pickup = Veh(f"pickup {v.plate}", v.plate, None, 4.6, 1.8, 1.5, spacings=[2.9])
        r = yield Ev(start, "IN", pickup, w.w(pickup, 0), tag=None, honest=False)
        c.saw(r, start)
        load_t = w.u(1.0, 1.4)
        out_at = start + mins(20, 40)
        r = yield Ev(out_at, "OUT", pickup, w.w(pickup, load_t), tag=None, honest=False)
        c.saw(r, out_at)
        w.trip(out_at, pickup, load_t, "cheat", True, type_, cause="light vehicle")
        c.outcome = "detected" if c.alerts else "missed"
        c.note = "let through as a light vehicle; the load is not counted" + (" (flagged)" if c.alerts else "")

    elif type_ == "outage_trip":  # an extra truck moves while the pole is down; the barrier is lifted by hand
        window = w.down(start)
        if window is None:
            return w.drop(c, "no outage at that time")
        c.off(start, "pole down: barrier lifted by hand, extra truck comes in")
        out_at = min(start + mins(25, 40), window[1] - timedelta(minutes=1))
        c.off(out_at, "leaves loaded while the pole is still down")
        w.trip(out_at, v, load(v), "cheat", True, type_, cause="pole down")
        c.outcome, c.note = "missed", "moved while the pole was down; nothing reached the GB"
        return
        yield  # noqa: unreachable; makes this a generator

    else:
        raise ValueError(f"unknown cheat type {type_}")


# ================================================================ scheduling
RESERVE_H = {"side_track_out": 5, "officer_cover": 6}
HOLDS_TRUCK = ("clone", "pass_reuse", "pass_handover")  # truck stays on hold until the end-of-day review


def plan_cheats(w: World) -> list[tuple[datetime, object]]:
    starts = []
    for d in w.days:
        for spec in w.cfg.get("cheats", []):
            type_, per_day = spec["type"], float(spec.get("per_day", 1))
            n = int(per_day) + (1 if w.rng.random() < per_day - int(per_day) else 0)
            for _ in range(n):
                if type_ == "outage_trip":
                    wins = [o for o in w.outages if o[0].date() == d]
                    if not wins:
                        continue
                    a, b = wins[0]
                    t = a + timedelta(minutes=w.u(0, max(1, (b - a).seconds / 60 - 30)))
                    starts.append((t, cheat_actor(w, type_, t, w.outsider(), "turn_back", None)))
                    continue
                if type_ == "light_vehicle":
                    t = w.at(d, w.hours_start, w.u(30, 600))
                    starts.append((t, cheat_actor(w, type_, t, w.outsider(), "turn_back", None)))
                    continue
                if type_ == "night_trip":
                    t = w.at(d, w.hours_end, w.u(60, 240))
                else:
                    t = w.at(d, w.hours_start, w.u(30, (w.at(d, w.hours_end) - w.at(d, w.hours_start)).seconds / 60 - 200))
                on_refusal = w.choose(spec.get("on_refusal", "turn_back"))
                if type_ == "unregistered":
                    starts.append((t, cheat_actor(w, type_, t, w.outsider(), on_refusal, None)))
                    continue
                if type_ == "side_track_both":  # never touches a gate: any truck will do
                    starts.append((t, cheat_actor(w, type_, t, w.rng.choice(w.fleet + w.pool), on_refusal, None)))
                    continue
                need = 2 if type_ == "pass_handover" else 1
                free = sorted((at, lbl) for lbl, at in w.pool_free.items())
                picked = [lbl for at, lbl in free if at <= t][:need]
                if len(picked) < need:
                    w.skipped.append(f"{type_} on {d}: no free test truck")
                    continue
                vehs = [next(x for x in w.pool if x.label == lbl) for lbl in picked]
                for lbl in picked:
                    w.pool_free[lbl] = (w.at(d + timedelta(days=1), w.hours_start) if type_ in HOLDS_TRUCK
                                        else t + timedelta(hours=RESERVE_H.get(type_, 2.5)))
                if type_ == "side_track_out":  # its pass stays open for good: no more episodes for this truck
                    w.pool_free.pop(picked[0])
                starts.append((t, cheat_actor(w, type_, t, vehs[0], on_refusal, vehs[1] if need == 2 else None)))
    return starts


def reference_test(w: World, permit: dict, at: datetime, officer_id: int):
    """Gap 1B: an officer runs the GB's reference load over the pad at a random time. The rigged pad (weigh_drift)
    reads it light too, since a reference load is a loaded reading."""
    known = float(w.cfg["reference_test"].get("known_t", 30))
    reading = known
    if w.drift and (at.date() - w.days[0]).days + 1 >= w.drift["from_day"]:
        reading = known + w.drift["offset_t"]
    r = w.client.post(f"/api/gates/{GATE}/reference-test", headers={"X-Officer-Id": str(officer_id)},
                      json={"known_weight_t": known, "pad_reading_t": round(reading, 2), "observed_at": at.isoformat(),
                            "permit_id": permit["id"]}).raise_for_status().json()
    w.reference_tests.append({"at": at.strftime("%Y-%m-%d %H:%M"), "known_t": known, "read_t": round(reading, 2),
                              "passed": r["passed"]})
    return
    yield  # noqa: unreachable; makes this a generator


def survey(w: World, permit: dict, d: date, officer_id: int) -> None:
    """Gap 7: the GB's weekly survey (RTK drone photogrammetry). Staged from ground truth: the ore that really left the
    site in the period, with a random survey error within +/- error_pct, as a volume at the in-situ density. No
    stockpiles in the simulation. The GB compares it with what its gates weighed out."""
    cfg = w.cfg["survey"]
    every = int(cfg.get("every_days", 7))
    i = (d - w.days[0]).days
    if (i + 1) % every:
        return
    d_from = w.days[i + 1 - every]
    in_period = [t for t in w.truth if d_from.isoformat() <= t["day"] <= d.isoformat()]
    true_t = sum(t["tonnes"] for t in in_period)
    # each survey makes a terrain model with its own error; a week's volume is the difference of two models, so its
    # error is (this model's - last model's), within +/- error_pct. Over many weeks the middle models cancel out.
    amp = cfg.get("error_pct", 3) / 100 / 2 * true_t
    if not w.model_errors:
        w.model_errors.append(w.survey_rng.uniform(-1, 1) * amp)  # the baseline survey at the start of the period
    w.model_errors.append(w.survey_rng.uniform(-1, 1) * amp)
    err = (w.model_errors[-1] - w.model_errors[-2]) / true_t if true_t else 0.0
    density = cfg.get("density", 3.2)
    body = {"period_from": d_from.isoformat(), "period_to": d.isoformat(), "method": "drone_photogrammetry",
            "volume_dug_m3": round(true_t * (1 + err) / density, 1), "density_t_m3": density,
            "stockpile_change_t": 0.0, "check_error_cm": round(w.survey_rng.uniform(1.5, 4.0), 1)}
    r = w.client.post(f"/api/permits/{permit['id']}/surveys", headers={"X-Officer-Id": str(officer_id)},
                      json=body).raise_for_status().json()
    w.surveys.append({**r, "true_out_t": round(true_t, 2), "survey_error_pct": round(err * 100, 2)})


def end_of_day(w: World, permit: dict, d: date, officer_id: int) -> None:
    """The Vendor files its report for the day (CP9); a GB officer reviews and releases the day's holds."""
    day = d.isoformat()
    true_trips = [t for t in w.truth if t["day"] == day]
    mode = w.cfg.get("vendor_report", {}).get("mode", "truthful")
    trips, tonnes = len(true_trips), sum(t["tonnes"] for t in true_trips)
    if mode == "legal_only":
        legal = [t for t in true_trips if t["kind"] == "legal"]
        trips, tonnes = len(legal), sum(t["tonnes"] for t in legal)
    elif mode == "cap_at_permit":
        allowed = max(0, permit["trip_limit"] - w.vendor_cum)
        if trips > allowed:
            tonnes = tonnes * allowed / trips if trips else 0
            trips = allowed
    elif mode == "under_by_pct":
        pct = w.cfg["vendor_report"].get("pct", 15) / 100
        trips, tonnes = round(trips * (1 - pct)), tonnes * (1 - pct)
    w.vendor_cum += trips
    res = w.client.post(f"/api/permits/{permit['id']}/vendor-reports",
                        json={"day": day, "trips": trips, "tonnes": round(tonnes, 2)}).raise_for_status().json()
    w.vendor.append({"day": day, "trips": trips, "tonnes": round(tonnes, 2), "true_trips": len(true_trips),
                     "alerts": [a["code"] for a in res["alerts"]]})
    if w.cfg.get("survey"):
        survey(w, permit, d, officer_id)
    for h in w.client.get(f"/api/holds?permit_id={permit['id']}").raise_for_status().json():
        w.client.post(f"/api/holds/{h['id']}/release", headers={"X-Officer-Id": str(officer_id)},
                      json={"reason": "Reviewed at end of day (simulated officer)"}).raise_for_status()


def post(w: World, permit: dict, source: str, ev: Ev) -> dict:
    v = ev.veh
    plate = v.plate if ev.plate_shown == "own" else ev.plate_shown
    tag = v.tag if ev.tag == "own" else ev.tag
    weight = ev.weight
    if w.drift and ev.dir == "OUT" and weight is not None and (ev.at.date() - w.days[0]).days + 1 >= w.drift["from_day"]:
        weight = round(weight + w.drift["offset_t"], 2)  # staging: the pad is rigged to read low when loaded
    ev.misread = False
    if ev.honest and w.noise_cfg:  # staging: camera / FASTag reader miss on an honest truck
        if w.rng.random() < w.noise_cfg.get("plate_miss", 0):
            plate, ev.misread = None, True
        elif w.rng.random() < w.noise_cfg.get("fastag_miss", 0):
            tag, ev.misread = None, True
    body = {"direction": ev.dir, "plate_read": plate, "fastag_read": tag, "radar_length_m": v.length,
            "weight_t": weight, "observed_at": ev.at.isoformat(), "barrier_forced": ev.forced,
            "permit_id": permit["id"], "source": source, "rfid_sticker_uid": v.sticker, "rfid_sim_mode": ev.rfid}
    if ev.token:
        body["pass_token"] = ev.token
    if ev.code:
        body["pass_code"] = ev.code
    roll = w.wim_rng.random()  # staging: occasional WIM faults
    wim_status = "OFFLINE" if roll < w.wim_cfg.get("offline", 0) else \
        "POOR" if roll < w.wim_cfg.get("offline", 0) + w.wim_cfg.get("poor", 0) else "OK"
    wim = pole.wim_reading(w.wim_rng, v.spacings, v.empty, ev.weight, wim_status)  # the real weight, not the pad's
    if wim is not None:
        body["wim"] = wim
    return pole.event(w.client, GATE, body).raise_for_status().json()


def run_site(client: httpx.Client, cfg: dict, name: str, registry: dict[str, dict]) -> int:
    w = World(cfg, client, registry)
    p = cfg["permit"]
    run = client.post("/api/site-runs", json={"scenario": name, "description": cfg.get("description"),
                                              "seed": cfg.get("seed", 1), "days": len(w.days)}).raise_for_status().json()
    source = f"site:{run['id']}"
    permit = client.post("/api/permits", json={
        "label": f"Site run {run['id']} {name}", "source": source,
        "valid_from": w.days[0].isoformat(), "valid_to": w.days[-1].isoformat(),
        "trip_limit": p["trip_limit"], "tonne_limit": p["tonne_limit"], "vehicle_limit": p.get("vehicle_limit", 20),
        "hours_start": p.get("hours_start", "06:00"), "hours_end": p.get("hours_end", "18:00"),
        "exit_grace_min": p.get("exit_grace_min", 30), "pass_expiry_min": p.get("pass_expiry_min", 120),
    }).raise_for_status().json()
    officers = client.get("/api/officers").raise_for_status().json()
    officer_id = next((o["id"] for o in officers if o["role"] == "approver"), officers[0]["id"])
    w.permit_id = permit["id"]
    w.bribed_officer = next((o["id"] for o in officers if o["id"] != officer_id and o.get("active")), officer_id) \
        if cfg.get("bribed_officer") else None

    print(f"\nSiteWatch site run #{run['id']} | {name} | {len(w.days)} days {w.days[0]} to {w.days[-1]} | "
          f"fleet {len(w.fleet)} trucks, {len(w.pool)} test trucks for cheats | seed {cfg.get('seed', 1)}")
    print(f"{cfg.get('description', '')}\n")

    heap: list = []
    seq = 0
    for v in w.fleet:
        heap.append((w.at(w.days[0], w.hours_start), seq, honest_truck(w, v), None))
        seq += 1
    for t, actor in plan_cheats(w):
        heap.append((t, seq, actor, None))
        seq += 1
    if cfg.get("reference_test"):  # gap 1B: one unannounced reference weight test a day
        for d in w.days:
            t = w.at(d, w.hours_start, w.u(30, (w.at(d, w.hours_end) - w.at(d, w.hours_start)).seconds / 60 - 30))
            heap.append((t, seq, reference_test(w, permit, t, officer_id), None))
            seq += 1
    heapq.heapify(heap)

    day_i = 0
    posted = 0
    beat_at = w.at(w.days[0], time(0, 0))
    heartbeats = bool(cfg.get("heartbeats"))
    while heap:
        at, _, actor, ev = heapq.heappop(heap)
        if ev is not None and w.down(at):  # pole down: the barrier doesn't work, trucks at the gate wait
            w.waits_for_outage += 1
            ev.at = w.down(at)[1]
            seq += 1
            heapq.heappush(heap, (ev.at, seq, actor, ev))
            continue
        while heartbeats and beat_at + timedelta(minutes=15) <= at:  # the pole's 'I'm alive' signal (staging)
            beat_at += timedelta(minutes=15)
            if not w.down(beat_at):
                pole.heartbeat(client, GATE, {"at": beat_at.isoformat(), "permit_id": permit["id"], "source": source})
        while day_i < len(w.days) - 1 and at.date() > w.days[day_i]:
            end_of_day(w, permit, w.days[day_i], officer_id)
            day_i += 1
        try:
            if ev is None:
                nxt = next(actor)
            else:
                ev.resp = post(w, permit, source, ev)
                w.events.append(ev)
                posted += 1
                if posted % 250 == 0:
                    print(f"  ... {posted} gate events ({at:%d %b %H:%M})")
                nxt = actor.send(ev.resp)
        except StopIteration:
            continue
        nxt.at = max(nxt.at, at)
        seq += 1
        heapq.heappush(heap, (nxt.at, seq, actor, nxt))
    while day_i < len(w.days):
        end_of_day(w, permit, w.days[day_i], officer_id)
        day_i += 1

    report = build_report(w, permit, client, posted)
    client.put(f"/api/site-runs/{run['id']}", json={"permit_id": permit["id"], "report": report}).raise_for_status()
    print_report(report)
    return 0


# ================================================================ report
def missed_by_cause(w: World, ledger: dict) -> dict:
    """Trips and tonnes that really moved but the GB doesn't have, grouped by why."""
    out: dict[str, dict] = {}
    for t in w.truth:
        cause = t.get("cause")
        if cause:  # unseen at a gate (side track, pole down) or seen but not counted (light vehicle)
            row = out.setdefault(cause, {"trips": 0, "tonnes": 0.0})
            row["trips"] += 1
            row["tonnes"] = round(row["tonnes"] + t["tonnes"], 2)
    # exits the gates saw and counted as legal, but recorded lighter than the real load (rigged pad), or not weighed
    short = sum((e.weight or 0) - (e.resp.get("weight_t") or 0) for e in w.events
                if e.dir == "OUT" and e.resp and e.resp.get("trip") == "LEGAL" and e.weight is not None
                and e.resp.get("weight_t") is not None)
    if short > 1:
        out["weighed short (rigged pad)"] = {"trips": 0, "tonnes": round(short, 2)}
    unweighed = [e for e in w.events if e.dir == "OUT" and e.resp and e.resp.get("trip") == "LEGAL"
                 and e.resp.get("weight_t") is None]
    if unweighed:
        out["not weighed (pad bypassed)"] = {"trips": len(unweighed), "tonnes": None}
    return out


def build_report(w: World, permit: dict, client: httpx.Client, posted: int) -> dict:
    ledger = client.get(f"/api/permits/{permit['id']}/ledger").raise_for_status().json()
    daily = client.get(f"/api/permits/{permit['id']}/ledger/daily").raise_for_status().json()
    alerts = client.get(f"/api/alerts?permit_id={permit['id']}&limit=5000").raise_for_status().json()
    if any(a["code"] in ("VOLUME_MISMATCH", "VOLUME_TREND") for a in alerts):  # the survey shows leakage, not which trip
        for c in w.cheats:
            if c.type in ("side_track_both", "light_vehicle") and c.outcome == "missed" and not c.attempt_flagged:
                c.attempt_flagged = True
                c.note += " (leakage shown by the weekly survey)"
    if any(a["code"] == "POLE_SILENT" for a in alerts):  # the GB knows the pole was down, not what moved meanwhile
        for c in w.cheats:
            if c.type == "outage_trip":
                c.attempt_flagged = True
                c.note += " (pole outage flagged: POLE_SILENT)"

    truth_trips, truth_t = len(w.truth), sum(t["tonnes"] for t in w.truth)
    invisible = [t for t in w.truth if not t["crossed_gate"]]
    vendor_trips, vendor_t = sum(v["trips"] for v in w.vendor), sum(v["tonnes"] for v in w.vendor)
    illegal_t_est = sum(
        (e.weight or 0) - e.veh.empty for e in w.events
        if e.resp and e.resp.get("trip") == "ILLEGAL" and e.weight is not None
    )

    by_type: dict[str, dict] = {}
    for c in w.cheats:
        row = by_type.setdefault(c.type, {"injected": 0, "prevented": 0, "detected": 0, "missed": 0,
                                          "attempt_flagged": 0, "alert_delays": []})
        row["injected"] += 1
        row[c.outcome] += 1
        row["attempt_flagged"] += int(c.attempt_flagged)
        if c.first_alert_min is not None:
            row["alert_delays"].append(c.first_alert_min)
    for row in by_type.values():
        d = row.pop("alert_delays")
        row["avg_minutes_to_alert"] = round(sum(d) / len(d), 1) if d else None

    false_alarms = []
    for e in w.events:
        if not e.honest or not e.resp:
            continue
        for a in e.resp["alerts"]:
            if a["severity"] in SERIOUS and not a["code"].startswith(PERMIT_WARNINGS) and a["code"] not in EQUIPMENT_ALERTS:
                false_alarms.append({"at": e.at.strftime("%d %b %H:%M"), "vehicle": e.veh.label, "code": a["code"],
                                     "message": a["message"]})
    honest_events = sum(1 for e in w.events if e.honest)

    sev: dict[str, int] = {}
    codes: dict[str, int] = {}
    for a in alerts:
        sev[a["severity"]] = sev.get(a["severity"], 0) + 1
        codes[a["code"]] = codes.get(a["code"], 0) + 1

    truth_by_day: dict[str, dict] = {}
    for t in w.truth:
        row = truth_by_day.setdefault(t["day"], {"trips": 0, "tonnes": 0.0, "invisible": 0})
        row["trips"] += 1
        row["tonnes"] += t["tonnes"]
        row["invisible"] += int(not t["crossed_gate"])
    gb_by_day = {d["day"]: d for d in daily}
    vendor_by_day = {v["day"]: v for v in w.vendor}
    days = []
    for d in w.days:
        k = d.isoformat()
        g = gb_by_day.get(k, {})
        days.append({
            "day": k, "gb_legal": g.get("legal_trips", 0), "gb_actual": g.get("actual_trips", 0),
            "gb_illegal": g.get("illegal_trips", 0), "entry_refusals": g.get("entry_refusals", 0),
            "exit_refusals": g.get("exit_refusals", 0), "gb_tonnes": g.get("tonnes", 0),
            "true_trips": truth_by_day.get(k, {}).get("trips", 0),
            "true_tonnes": round(truth_by_day.get(k, {}).get("tonnes", 0.0), 2),
            "invisible_trips": truth_by_day.get(k, {}).get("invisible", 0),
            "vendor_trips": vendor_by_day.get(k, {}).get("trips", 0),
            "vendor_tonnes": vendor_by_day.get(k, {}).get("tonnes", 0),
            "vendor_alerts": vendor_by_day.get(k, {}).get("alerts", []),
            "alerts": g.get("alerts", {}),
        })

    injected = len(w.cheats)
    return {
        "config": {"days": [d.isoformat() for d in (w.days[0], w.days[-1])], "fleet": len(w.fleet),
                   "test_trucks": len(w.pool), "seed": w.cfg.get("seed", 1), "permit": w.cfg["permit"],
                   "after_quota": w.cfg.get("after_quota"), "vendor_report": w.cfg.get("vendor_report"),
                   "cheats": w.cfg.get("cheats", [])},
        "permit_id": permit["id"],
        "gate_events": posted,
        "headline": {
            "trips": {"permitted": permit["trip_limit"], "vendor_reported": vendor_trips,
                      "gb_legal": ledger["legal_trips"], "gb_actual": ledger["actual_trips"],
                      "gb_illegal": ledger["illegal_trips"], "ground_truth": truth_trips},
            "tonnes": {"permitted": permit["tonne_limit"], "vendor_reported": round(vendor_t, 2),
                       "gb_legal": ledger["tonnes"], "gb_actual": round(ledger["tonnes"] + illegal_t_est, 2),
                       "gb_illegal": round(illegal_t_est, 2), "ground_truth": round(truth_t, 2)},
        },
        "accuracy": {
            "true_trips": truth_trips, "gb_actual_trips": ledger["actual_trips"],
            "trips_never_at_a_gate": len(invisible),
            "never_at_a_gate": invisible,  # each trip: day, at, vehicle, tonnes, cheat
            "trips_seen_pct": round(100 * ledger["actual_trips"] / truth_trips, 1) if truth_trips else 100.0,
            "true_tonnes": round(truth_t, 2),
            "gb_tonnes_weighed": round(ledger["tonnes"] + illegal_t_est, 2),
            "open_passes": ledger["open_passes"],
        },
        "cheats_summary": {
            "injected": injected,
            "prevented": sum(c.outcome == "prevented" for c in w.cheats),
            "detected": sum(c.outcome == "detected" for c in w.cheats),
            "missed": sum(c.outcome == "missed" for c in w.cheats),
            "missed_attempt_flagged": sum(c.outcome == "missed" and c.attempt_flagged for c in w.cheats),
        },
        "cheats_by_type": by_type,
        "cheats": [c.as_dict() for c in w.cheats],
        "missed_by_cause": missed_by_cause(w, ledger),
        "surveys": w.surveys,
        "staging": {"outages": [[a.strftime("%Y-%m-%d %H:%M"), b.strftime("%H:%M")] for a, b in w.outages],
                    "weigh_drift": w.drift, "sensor_noise": w.noise_cfg or None,
                    "bribed_officer": w.cfg.get("bribed_officer"), "honest_refused_by_misreads": w.misread_refusals,
                    "events_held_by_outages": w.waits_for_outage, "reference_tests": w.reference_tests},
        "alerts": {"by_severity": {s: sev.get(s, 0) for s in ("CRITICAL", "HIGH", "MEDIUM", "INFO")},
                   "by_code": dict(sorted(codes.items(), key=lambda kv: -kv[1]))},
        "false_alarms": {"count": len(false_alarms), "honest_events": honest_events, "items": false_alarms[:50]},
        "vendor": w.vendor,
        "daily": days,
        "unexpected": w.unexpected[:50],
        "skipped": w.skipped,
    }


def print_report(r: dict) -> None:
    h = r["headline"]
    print(f"\n {'':<10}{'Permit':>11}{'Vendor':>9}{'Pass':>10}{'Counted':>11}{'No pass':>9}{'Real':>9}")
    for k in ("trips", "tonnes"):
        x = h[k]
        print(f" {k:<10}{x['permitted']:>11g}{x['vendor_reported']:>9g}{x['gb_legal']:>10g}{x['gb_actual']:>11g}"
              f"{x['gb_illegal']:>9g}{x['ground_truth']:>9g}")
    s = r["cheats_summary"]
    print(f"\n Cheats injected {s['injected']}: prevented {s['prevented']}, detected {s['detected']}, missed "
          f"{s['missed']} ({s['missed_attempt_flagged']} with the attempt flagged)")
    for t, row in sorted(r["cheats_by_type"].items()):
        print(f"   {t:<24} injected {row['injected']:>3}  prevented {row['prevented']:>3}  detected {row['detected']:>3}"
              f"  missed {row['missed']:>3}")
    a = r["accuracy"]
    print(f"\n Trips seen by GB gates: {a['gb_actual_trips']} of {a['true_trips']} true ({a['trips_seen_pct']}%); "
          f"{a['trips_never_at_a_gate']} never crossed a gate")
    print(f" Alerts: {r['alerts']['by_severity']}   False alarms: {r['false_alarms']['count']} on "
          f"{r['false_alarms']['honest_events']} honest gate events")
    for u in r["unexpected"][:5]:
        print(f"   ! unexpected: {u}")
    for sk in r["skipped"][:5]:
        print(f"   - skipped: {sk}")
    print()


def main(name: str, client: httpx.Client, registry: dict[str, dict]) -> int:
    path = SITE_DIR / f"{name}.yaml"
    if not path.exists():
        print(f"No site scenario {path}")
        return 2
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    return run_site(client, cfg, name, registry)
