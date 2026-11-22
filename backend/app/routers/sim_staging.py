"""Staging only: lets the simulator act out cheats that are not a truck at a gate, so the threat-coverage runs can
measure what the GB misses. This is the attacker's side, not a GB feature: it plays an insider with direct database
access. It only touches simulation data (permits whose source starts with sim: or site:), never real gate data."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Alert, EventLog, Movement, Permit, TripSession

router = APIRouter(prefix="/api/sim", tags=["simulator staging"])

SIM_ORIGINS = ("sim:", "site:")


class InsiderEdit(BaseModel):
    permit_id: int
    action: str = Field(description="erase_illegal_trip | lower_weight")
    tonnes: float = 3.0  # lower_weight: how much to take off one recorded trip


@router.post("/insider-edit")
def insider_edit(body: InsiderEdit, db: Session = Depends(get_db)) -> dict:
    """An insider with database access edits stored records after the fact (threat E2). No log line, no alert: that is
    the point of the attack. Whether the GB notices is up to its record-integrity check."""
    permit = db.get(Permit, body.permit_id)
    if permit is None or not (permit.source or "").startswith(SIM_ORIGINS):
        raise HTTPException(403, "Staging edits are allowed only on simulation permits")
    if body.action == "erase_illegal_trip":
        m = db.scalar(select(Movement).where(Movement.permit_id == permit.id, Movement.trip == "ILLEGAL")
                      .order_by(Movement.id))
        if m is None:
            raise HTTPException(409, "No illegal trip to erase")
        db.execute(delete(Alert).where(Alert.movement_id == m.id))
        db.execute(delete(EventLog).where(EventLog.movement_id == m.id))
        db.delete(m)
        db.commit()
        return {"erased_movement": m.id}
    if body.action == "lower_weight":
        s = db.scalar(select(TripSession).where(TripSession.permit_id == permit.id, TripSession.net_t.is_not(None))
                      .order_by(TripSession.id))
        if s is None:
            raise HTTPException(409, "No weighed trip to edit")
        s.net_t = round(s.net_t - body.tonnes, 2)
        if s.exit_weight_t is not None:
            s.exit_weight_t = round(s.exit_weight_t - body.tonnes, 2)
        if s.exit_movement_id:
            m = db.get(Movement, s.exit_movement_id)
            if m is not None and m.weight_t is not None:
                m.weight_t = round(m.weight_t - body.tonnes, 2)
        db.commit()
        return {"edited_pass": s.trip_code, "net_t_now": s.net_t}
    raise HTTPException(400, "action must be erase_illegal_trip or lower_weight")
