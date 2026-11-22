"""Gate pole API: poles (real or simulated) post what they observe; the GB server decides.

One pipeline for every gate event (and for the officer's exit verification): Identify (plate + FASTag + length +
GB RFID sticker), then the entry or exit trip pipeline in services/trip.py.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import acting_officer
from app.models import Movement, Officer, Permit
from app.schemas import (GateDecisionOut, GateEventIn, MovementOut, OfficerActionIn, PassFull, PassSummary,
                         TripCheckOut, TripSessionOut)
from app.services import cleanup, logbus, trip
from app.services.identify import Reading, describe, identify
from app.services.logbus import LogLine

router = APIRouter(prefix="/api", tags=["gates"])

SIM_PREFIX = "sim:"
WALKTHROUGH_PREFIX = "walkthrough:"
SITE_PREFIX = "site:"


def _pole_line(gate: str, body: GateEventIn) -> LogLine:
    tag = body.fastag_read
    tag_txt = f"{tag[:8]}…{tag[-4:]}" if tag and len(tag) > 12 else (tag or "none")
    length = f"{body.radar_length_m:.2f} m" if body.radar_length_m is not None else "no length"
    weight = f"{body.weight_t:.2f} t" if body.weight_t is not None else "no weight"
    rfid = body.rfid_sticker_uid or "none"
    rfid_mode = f" ({body.rfid_sim_mode})" if body.rfid_sticker_uid and body.rfid_sim_mode not in (None, "genuine") else ""
    shown = " · QR shown" if (body.pass_token or body.qr_token) else " · SMS code given" if body.pass_code else ""
    forced = " · BARRIER IMPACT" if body.barrier_forced else ""
    return LogLine(
        "POLE", "INFO",
        f"{gate} {body.direction}: vehicle at the barrier. Plate {body.plate_read or 'none'} · FASTag {tag_txt} · "
        f"GB sticker {rfid}{rfid_mode} · radar {length} · weigh pad {weight}{shown}{forced}",
        {"plate_read": body.plate_read, "fastag_read": body.fastag_read, "radar_length_m": body.radar_length_m,
         "weight_t": body.weight_t, "rfid_sticker_uid": body.rfid_sticker_uid, "rfid_sim_mode": body.rfid_sim_mode},
    )


def resolve_permit(db: Session, permit_id: int | None) -> Permit:
    """The permit this gate event counts against. A real pole's gate is configured to its contract's permit; in
    the PoC the simulator and Gate console pass their own permit_id, otherwise the latest real permit is used."""
    if permit_id is not None:
        permit = db.get(Permit, permit_id)
        if permit is None:
            raise HTTPException(404, f"Permit {permit_id} not found")
        return permit
    permit = db.scalar(select(Permit).where(Permit.source.is_(None)).order_by(Permit.id.desc()))
    if permit is None:
        raise HTTPException(409, "No permit configured")
    return permit


def process_gate_event(db: Session, gate: str, body: GateEventIn) -> GateDecisionOut:
    """Identify the vehicle, run the entry or exit pipeline, store movement + alerts + log lines, stream the logs."""
    gate = gate.upper()
    permit = resolve_permit(db, body.permit_id)
    observed = body.observed_at or datetime.now(timezone.utc)
    reading = Reading(body.plate_read, body.fastag_read, body.radar_length_m)
    try:
        decision = identify(db, reading, mode=settings.identify_mode)
    except ValueError as exc:
        raise HTTPException(500, str(exc)) from exc
    trip.sweep_expired(db, permit, observed)  # P10 at the pole's event time
    movement = Movement(
        gate=gate,
        direction=body.direction,
        observed_at=observed,
        plate_read=body.plate_read,
        plate_normalised=decision.plate_normalised,
        fastag_read=body.fastag_read,
        radar_length_m=body.radar_length_m,
        rfid_sticker_uid=body.rfid_sticker_uid,
        result=decision.result,
        truck_id=decision.truck.id if decision.truck else None,
        identify_mode=settings.identify_mode,
        checks=[c.as_dict() for c in decision.checks],
        caught_by=decision.caught_by,
        reasons=decision.reasons,
        flags=decision.flags,
        source=body.source,
        permit_id=permit.id,
        weight_t=body.weight_t,
        barrier_forced=body.barrier_forced,
    )
    db.add(movement)
    db.flush()
    t = trip.Trip(db, permit, movement, decision, decision.involved, pass_token=body.pass_token or body.qr_token,
                  pass_code=body.pass_code, sticker_uid=body.rfid_sticker_uid,
                  rfid_mode=body.rfid_sim_mode or "genuine")
    trip.process(t)
    db.flush()
    rows = logbus.save(db, [_pole_line(gate, body), *describe(decision), *t.lines], source=body.source,
                       movement_id=movement.id)
    db.commit()
    db.refresh(movement)
    logbus.publish(rows)
    return _decision_out(db, movement, t)


def _decision_out(db: Session, movement: Movement, t: trip.Trip) -> GateDecisionOut:
    out = GateDecisionOut.model_validate(movement)
    out.trip_checks = [TripCheckOut(**c) for c in t.trip_checks()]
    out.trip_decision = t.trip_decision
    if t.session is not None:
        db.refresh(t.session)
        out.trip_session = TripSessionOut.model_validate(t.session)
    if t.quota is not None:
        out.quota_remaining, out.quota_max = t.quota.remaining_trips, t.quota.max_trips
    if t.issued is not None:
        s = t.issued
        out.issued_pass = PassFull.model_validate({**PassSummary.model_validate(s).model_dump(), "token": s.token,
                                                   "sms_code": s.sms_code, "plate": s.truck.plate})
    return out


@router.post("/gates/{gate}/events", response_model=GateDecisionOut, status_code=201)
def gate_event(gate: str, body: GateEventIn, db: Session = Depends(get_db)):
    """A vehicle arrived at a gate barrier: identify it (plate + FASTag + length + GB RFID sticker), then run the
    entry or exit pipeline (pass, weight, quota, barrier)."""
    return process_gate_event(db, gate, body)


@router.post("/movements/{movement_id}/officer-exit", response_model=GateDecisionOut, status_code=201)
def officer_exit(movement_id: int, body: OfficerActionIn, db: Session = Depends(get_db),
                 officer: Officer = Depends(acting_officer)):
    """An officer lets out a truck whose exit was refused (lost QR, expired pass, sticker unreadable): the truck's
    own pass is closed by the officer and flagged; the trip counts. Refused while the truck is on hold."""
    refused = db.get(Movement, movement_id)
    if refused is None:
        raise HTTPException(404, "Movement not found")
    try:
        t = trip.officer_exit(db, refused, officer.name, body.reason, body.observed_at or datetime.now(timezone.utc))
    except trip.OfficerActionError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.flush()
    rows = logbus.save(db, [LogLine("ACT", "WARN", f"{refused.gate} exit: officer {officer.name} lets "
                                                   f"{t.decision.truck.plate} out after a refused exit: {body.reason}"),
                            *t.lines], source=refused.source, movement_id=t.movement.id)
    db.commit()
    db.refresh(t.movement)
    logbus.publish(rows)
    return _decision_out(db, t.movement, t)


@router.delete("/walkthrough-history")
def clear_walkthrough_history(db: Session = Depends(get_db)):
    """Gate console only: delete every Gate console session (its permits, gate events, passes, holds, alerts and
    log lines) so a demo starts from a clean slate. Real gate data, scenario runs and site runs are not touched."""
    counts = cleanup.clear_source(db, WALKTHROUGH_PREFIX)
    db.commit()
    return counts


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    result: str | None = None,
    gate: str | None = None,
    source_prefix: str | None = Query(None, description="e.g. 'sim:12:' for one simulator run"),
    permit_id: int | None = None,
    origin: Literal["pole", "sim", "walkthrough", "site"] | None = Query(
        None, description="pole = real poles only, sim = simulator runs, walkthrough = gate console, site = site runs"
    ),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Movement).order_by(Movement.id.desc()).limit(limit)
    if origin == "sim":
        stmt = stmt.where(Movement.source.startswith(SIM_PREFIX))
    elif origin == "walkthrough":
        stmt = stmt.where(Movement.source.startswith(WALKTHROUGH_PREFIX))
    elif origin == "site":
        stmt = stmt.where(Movement.source.startswith(SITE_PREFIX))
    elif origin == "pole":
        stmt = stmt.where(
            or_(
                Movement.source.is_(None),
                and_(~Movement.source.startswith(SIM_PREFIX), ~Movement.source.startswith(WALKTHROUGH_PREFIX),
                     ~Movement.source.startswith(SITE_PREFIX)),
            )
        )
    if result:
        stmt = stmt.where(Movement.result == result)
    if gate:
        stmt = stmt.where(Movement.gate == gate.upper())
    if source_prefix:
        stmt = stmt.where(Movement.source.startswith(source_prefix))
    if permit_id is not None:
        stmt = stmt.where(Movement.permit_id == permit_id)
    return db.scalars(stmt).all()
