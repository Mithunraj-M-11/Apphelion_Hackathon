"""Gate pole API: poles (real or simulated) post what they observe; the GB server decides."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Movement, Permit
from app.schemas import GateDecisionOut, GateEventIn, MovementOut, PassFull, PassSummary
from app.services import logbus, trip
from app.services.identify import Reading, describe, identify
from app.services.logbus import LogLine

router = APIRouter(prefix="/api", tags=["gates"])

SIM_PREFIX = "sim:"
WALKTHROUGH_PREFIX = "walkthrough:"


def _pole_line(gate: str, body: GateEventIn) -> LogLine:
    tag = body.fastag_read
    tag_txt = f"{tag[:8]}…{tag[-4:]}" if tag and len(tag) > 12 else (tag or "none")
    length = f"{body.radar_length_m:.2f} m" if body.radar_length_m is not None else "no length"
    weight = f"{body.weight_t:.2f} t" if body.weight_t is not None else "no weight"
    shown = " · QR shown" if body.pass_token else " · SMS code given" if body.pass_code else ""
    forced = " · BARRIER IMPACT" if body.barrier_forced else ""
    return LogLine(
        "POLE", "INFO",
        f"{gate} {body.direction}: vehicle at the barrier. Plate {body.plate_read or 'none'} · FASTag {tag_txt} · "
        f"radar {length} · weigh pad {weight}{shown}{forced}",
        {"plate_read": body.plate_read, "fastag_read": body.fastag_read, "radar_length_m": body.radar_length_m,
         "weight_t": body.weight_t},
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


@router.post("/gates/{gate}/events", response_model=GateDecisionOut, status_code=201)
def gate_event(gate: str, body: GateEventIn, db: Session = Depends(get_db)):
    """A vehicle arrived at a gate. Identify it, then run the entry or exit pipeline (pass, weight, quota,
    barrier), store the movement, alerts and log lines, and stream the log lines live."""
    gate = gate.upper()
    permit = resolve_permit(db, body.permit_id)
    reading = Reading(body.plate_read, body.fastag_read, body.radar_length_m)
    try:
        decision = identify(db, reading, mode=settings.identify_mode)
    except ValueError as exc:
        raise HTTPException(500, str(exc)) from exc
    movement = Movement(
        gate=gate,
        direction=body.direction,
        observed_at=body.observed_at or datetime.now(timezone.utc),
        plate_read=body.plate_read,
        plate_normalised=decision.plate_normalised,
        fastag_read=body.fastag_read,
        radar_length_m=body.radar_length_m,
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
    t = trip.Trip(db, permit, movement, decision, decision.involved, pass_token=body.pass_token,
                  pass_code=body.pass_code)
    trip.process(t)
    db.flush()
    rows = logbus.save(db, [_pole_line(gate, body), *describe(decision), *t.lines], source=body.source,
                       movement_id=movement.id)
    db.commit()
    db.refresh(movement)
    logbus.publish(rows)
    out = GateDecisionOut.model_validate(movement)
    if t.issued is not None:
        p = t.issued
        out.issued_pass = PassFull.model_validate({**PassSummary.model_validate(p).model_dump(), "token": p.token,
                                                   "sms_code": p.sms_code, "plate": p.truck.plate})
    return out


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    result: str | None = None,
    gate: str | None = None,
    source_prefix: str | None = Query(None, description="e.g. 'sim:12:' for one simulator run"),
    permit_id: int | None = None,
    origin: Literal["pole", "sim", "walkthrough"] | None = Query(
        None, description="pole = real poles only, sim = simulator runs, walkthrough = gate console"
    ),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Movement).order_by(Movement.id.desc()).limit(limit)
    if origin == "sim":
        stmt = stmt.where(Movement.source.startswith(SIM_PREFIX))
    elif origin == "walkthrough":
        stmt = stmt.where(Movement.source.startswith(WALKTHROUGH_PREFIX))
    elif origin == "pole":
        stmt = stmt.where(
            or_(
                Movement.source.is_(None),
                and_(~Movement.source.startswith(SIM_PREFIX), ~Movement.source.startswith(WALKTHROUGH_PREFIX)),
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
