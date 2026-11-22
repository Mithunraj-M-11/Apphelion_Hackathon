"""Integrity of the GB's own equipment and records (gaps 2, 3, 4 and 5 of docs/implementation/threat_coverage.md).

- Pole liveness: poles send a heartbeat every few minutes; a silence longer than POLE_SILENT_AFTER is a POLE_SILENT
  alert (the brief: loss of signal is suspicious). Judged when the pole is heard again (heartbeat or gate event); a
  real deployment adds a watchdog that raises it while the pole is still silent.
- Late events: an event whose pole time is well behind the latest signal from that pole reached the GB late
  (network cut): LATE_EVENT.
- Pole signatures: every gate event and heartbeat is signed by the pole (HMAC-SHA256 with the pole's own key); an
  unsigned or wrongly signed one is refused and reported as FAKE_GATE_EVENT.
- Record: a hash chain over gate events per permit; verify() recomputes it and reports RECORD_TAMPERED when a stored
  event was edited or deleted. A real deployment also sends each day's chain head off site so the chain itself can't
  be rewritten.
"""

import hashlib
import hmac
import json
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Alert, Movement, Permit, PoleState, RecordEntry, TripSession

POLE_SILENT_AFTER = timedelta(minutes=20)  # heartbeats every 5 (scenarios) or 15 (site runs) minutes
LATE_AFTER = timedelta(minutes=30)
ZERO = "0" * 64


# ---------------------------------------------------------------- pole signatures (gap 4)
def pole_key(gate: str) -> bytes:
    """Each pole's own key, derived from the GB master secret (PoC; real poles keep theirs in a secure element)."""
    return hmac.new(settings.pole_master_key.encode(), f"pole:{gate.upper()}".encode(), hashlib.sha256).digest()


def sign(gate: str, raw: bytes) -> str:
    return hmac.new(pole_key(gate), raw, hashlib.sha256).hexdigest()


def signature_ok(gate: str, raw: bytes, signature: str | None) -> bool:
    return bool(signature) and hmac.compare_digest(sign(gate, raw), signature or "")


def report_fake(db: Session, permit: Permit, gate: str, body: dict, signature: str | None) -> Alert:
    """An event no GB pole signed: refused, and recorded as an attempt to inject data."""
    why = "unsigned" if not signature else "signature does not match the pole's key"
    a = Alert(permit_id=permit.id, code="FAKE_GATE_EVENT", severity="CRITICAL",
              message=f"Gate event for {gate} refused ({why}): {body.get('direction', '?')} "
                      f"{body.get('plate_read') or 'no plate'} at {body.get('observed_at') or 'unknown time'}. "
                      "Someone is posting events that no GB pole sent.",
              status="open", source=permit.source)
    db.add(a)
    return a


# ---------------------------------------------------------------- pole liveness and late events (gaps 2, 3)
def _state(db: Session, gate: str, source: str | None, permit: Permit) -> PoleState:
    st = db.scalar(select(PoleState).where(PoleState.gate == gate, PoleState.source == (source or "")))
    if st is None:
        st = PoleState(gate=gate, source=source or "", permit_id=permit.id)
        db.add(st)
    return st


def signal(db: Session, permit: Permit, gate: str, at: datetime, source: str | None, *, heartbeat: bool,
           movement_id: int | None = None) -> list[Alert]:
    """A sign of life from a pole at pole time `at`. Returns POLE_SILENT / LATE_EVENT alerts (not yet committed)."""
    gate = gate.upper()
    st = _state(db, gate, source, permit)
    alerts: list[Alert] = []
    last = st.last_seen
    if heartbeat:
        st.sends_heartbeats = True
    if last is not None:
        if st.sends_heartbeats and at - last > POLE_SILENT_AFTER:
            minutes = int((at - last).total_seconds() // 60)
            alerts.append(Alert(permit_id=permit.id, movement_id=movement_id, code="POLE_SILENT", severity="HIGH",
                                message=f"Pole {gate} was silent for {minutes} min ({last:%H:%M} to {at:%H:%M}): power "
                                        "cut, damage or tampering. Anything that moved in that window is unrecorded.",
                                status="open", source=permit.source))
        if not heartbeat and last - at > LATE_AFTER:
            hours = (last - at).total_seconds() / 3600
            alerts.append(Alert(permit_id=permit.id, movement_id=movement_id, code="LATE_EVENT", severity="MEDIUM",
                                message=f"Gate event from {at:%H:%M} reached the GB {hours:.1f} h late (pole had already "
                                        f"reported up to {last:%H:%M}): link to the pole was cut or held back.",
                                status="open", source=permit.source))
    if last is None or at > last:
        st.last_seen = at
    for a in alerts:
        db.add(a)
    return alerts


# ---------------------------------------------------------------- record chain (gap 5)
def _digest(db: Session, m: Movement) -> str:
    """The fields of a gate event as decided. For an exit that closed a pass, the pass's net tonnes too."""
    fields = {
        "id": m.id, "gate": m.gate, "direction": m.direction, "observed_at": m.observed_at.isoformat(),
        "plate_read": m.plate_read, "fastag_read": m.fastag_read, "radar_length_m": m.radar_length_m,
        "rfid": m.rfid_sticker_uid, "weight_t": m.weight_t, "result": m.result, "decision": m.decision,
        "barrier": m.barrier, "forced": m.barrier_forced, "trip": m.trip, "pass_id": m.pass_id,
    }
    if m.direction == "OUT" and m.pass_id:
        s = db.get(TripSession, m.pass_id)
        if s is not None and s.exit_movement_id == m.id:
            fields["net_t"] = s.net_t
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()


def chain_append(db: Session, m: Movement) -> None:
    if m.permit_id is None:
        return
    last = db.scalar(select(RecordEntry).where(RecordEntry.permit_id == m.permit_id).order_by(RecordEntry.seq.desc()))
    prev = last.hash if last else ZERO
    digest = _digest(db, m)
    db.add(RecordEntry(permit_id=m.permit_id, seq=(last.seq + 1) if last else 1, movement_id=m.id, digest=digest,
                       prev_hash=prev, hash=hashlib.sha256((prev + digest).encode()).hexdigest()))


def verify(db: Session, permit: Permit) -> dict:
    """Recompute the chain against the stored gate events. Raises RECORD_TAMPERED when anything was edited or deleted."""
    entries = db.scalars(select(RecordEntry).where(RecordEntry.permit_id == permit.id).order_by(RecordEntry.seq)).all()
    problems: list[str] = []
    prev = ZERO
    for e in entries:
        if e.prev_hash != prev or hashlib.sha256((e.prev_hash + e.digest).encode()).hexdigest() != e.hash:
            problems.append(f"link {e.seq}: the chain itself was altered")
        m = db.get(Movement, e.movement_id)
        if m is None:
            problems.append(f"gate event #{e.movement_id} was deleted")
        elif _digest(db, m) != e.digest:
            problems.append(f"gate event #{e.movement_id} was changed after it was recorded")
        prev = e.hash
    alert = None
    if problems:
        alert = Alert(permit_id=permit.id, code="RECORD_TAMPERED", severity="CRITICAL",
                      message=f"Record check failed: {'; '.join(problems[:5])}"
                              + (f" (and {len(problems) - 5} more)" if len(problems) > 5 else ""),
                      status="open", source=permit.source)
        db.add(alert)
    return {"permit_id": permit.id, "checked": len(entries), "intact": not problems, "problems": problems,
            "head": prev, "alert": alert.code if alert else None}


def chain_count(db: Session, permit_id: int) -> int:
    return db.scalar(select(func.count()).select_from(RecordEntry).where(RecordEntry.permit_id == permit_id)) or 0
