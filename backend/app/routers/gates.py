"""Gate pole API: poles (real or simulated) post what they observe; the GB server decides."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Movement
from app.schemas import GateEventIn, MovementOut
from app.services.identify import Reading, identify

router = APIRouter(prefix="/api", tags=["gates"])


@router.post("/gates/{gate}/events", response_model=MovementOut, status_code=201)
def gate_event(gate: str, body: GateEventIn, db: Session = Depends(get_db)):
    """A vehicle crossed a gate. Run Identify on the raw readings and store the movement."""
    reading = Reading(body.plate_read, body.fastag_read, body.radar_length_m)
    try:
        decision = identify(db, reading, mode=settings.identify_mode)
    except ValueError as exc:
        raise HTTPException(500, str(exc)) from exc
    movement = Movement(
        gate=gate.upper(),
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
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    result: str | None = None,
    gate: str | None = None,
    source_prefix: str | None = Query(None, description="e.g. 'sim:12:' for one simulator run"),
    origin: Literal["pole", "sim"] | None = Query(None, description="pole = real poles only, sim = simulator only"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Movement).order_by(Movement.id.desc()).limit(limit)
    if origin == "sim":
        stmt = stmt.where(Movement.source.startswith("sim:"))
    elif origin == "pole":
        stmt = stmt.where(or_(Movement.source.is_(None), ~Movement.source.startswith("sim:")))
    if result:
        stmt = stmt.where(Movement.result == result)
    if gate:
        stmt = stmt.where(Movement.gate == gate.upper())
    if source_prefix:
        stmt = stmt.where(Movement.source.startswith(source_prefix))
    return db.scalars(stmt).all()
