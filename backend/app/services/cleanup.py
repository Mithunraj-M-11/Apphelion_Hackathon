"""Clearing demo data by origin. Gate console sessions (walkthrough:), scenario runs (sim:) and site runs (site:) each
run under their own source-tagged permits, so each can be cleared without touching the others or real gate data."""

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.models import (Alert, EmergencyMovement, EventLog, Movement, Permit, TripSession, TruckHold, VehicleQuota,
                        VendorReport)

ORIGINS = ("walkthrough:", "sim:", "site:")  # never the real permit (source NULL)


def clear_source(db: Session, prefix: str) -> dict[str, int]:
    """Delete every permit whose source starts with `prefix`, with its gate events, passes, holds, alerts, quotas,
    Vendor reports and log lines. The caller commits."""
    if prefix not in ORIGINS:
        raise ValueError(f"Not a demo origin: {prefix!r}")
    like = f"{prefix}%"
    permits = list(db.scalars(select(Permit.id).where(Permit.source.like(like))))
    move_ids = list(db.scalars(select(Movement.id).where(
        or_(Movement.source.like(like), Movement.permit_id.in_(permits)))))
    session_ids = list(db.scalars(select(TripSession.id).where(
        or_(TripSession.source.like(like), TripSession.permit_id.in_(permits)))))
    db.execute(update(Movement).where(Movement.id.in_(move_ids)).values(pass_id=None))
    db.execute(update(TripSession).where(TripSession.id.in_(session_ids))
               .values(entry_movement_id=None, exit_movement_id=None))
    counts = {
        "alerts": db.execute(delete(Alert).where(or_(Alert.permit_id.in_(permits), Alert.movement_id.in_(move_ids),
                                                     Alert.pass_id.in_(session_ids)))).rowcount,
        "holds": db.execute(delete(TruckHold).where(or_(TruckHold.permit_id.in_(permits),
                                                        TruckHold.movement_id.in_(move_ids)))).rowcount,
        "logs": db.execute(delete(EventLog).where(or_(EventLog.source.like(like),
                                                      EventLog.movement_id.in_(move_ids)))).rowcount,
    }
    db.execute(delete(VendorReport).where(VendorReport.permit_id.in_(permits)))
    db.execute(delete(VehicleQuota).where(VehicleQuota.permit_id.in_(permits)))
    db.execute(delete(EmergencyMovement).where(EmergencyMovement.movement_id.in_(move_ids)))
    counts["passes"] = db.execute(delete(TripSession).where(TripSession.id.in_(session_ids))).rowcount
    counts["gate_events"] = db.execute(delete(Movement).where(Movement.id.in_(move_ids))).rowcount
    counts["permits"] = db.execute(delete(Permit).where(Permit.id.in_(permits))).rowcount
    return counts
