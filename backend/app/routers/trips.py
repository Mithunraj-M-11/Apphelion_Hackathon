"""Trip session and quota management API endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models.registry import Officer, Truck
from app.models.trip import QuotaAdjustment, TripSession, VehicleQuota
from app.schemas import (
    ExitVerifyIn,
    ExitVerifyOut,
    QuotaAdjustIn,
    QuotaAdjustmentOut,
    TripCheckOut,
    TripSessionOut,
    VehicleQuotaOut,
)
from app.services import logbus
from app.services.logbus import LogLine
from app.services.registry import record_history, snapshot
from app.services.plates import normalise_plate

router = APIRouter(prefix="/api", tags=["trips"])


# ---------- Trips ----------
@router.get("/trips", response_model=list[TripSessionOut])
def list_trips(
    status: str | None = Query(None, description="One status, or several separated by commas"),
    permit_id: int | None = None,
    plate: str | None = None,
    trip_code: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(TripSession).order_by(TripSession.id.desc()).limit(limit)
    if status:
        stmt = stmt.where(TripSession.status.in_([x.strip().upper() for x in status.split(",") if x.strip()]))
    if permit_id is not None:
        stmt = stmt.where(TripSession.permit_id == permit_id)
    if trip_code:
        stmt = stmt.where(TripSession.trip_code == trip_code)
    if plate:
        from app.services.plates import normalise_plate
        p = normalise_plate(plate)
        truck = db.scalar(select(Truck).where(Truck.plate == p))
        if truck:
            stmt = stmt.where(TripSession.truck_id == truck.id)
        else:
            return []
    return db.scalars(stmt).all()


@router.get("/trips/{session_id_or_pk}", response_model=TripSessionOut)
def get_trip(session_id_or_pk: str, db: Session = Depends(get_db)):
    if session_id_or_pk.isdigit():
        session = db.scalar(select(TripSession).where(TripSession.id == int(session_id_or_pk)))
    else:
        session = db.scalar(
            select(TripSession).where(
                (TripSession.session_id == session_id_or_pk) | (TripSession.trip_code == session_id_or_pk)
            )
        )
    if not session:
        raise HTTPException(404, "Trip session not found")
    return session


@router.post("/trips/{session_id}/resolve", response_model=TripSessionOut)
def resolve_trip(
    session_id: str,
    action: str = Query(..., description="RESOLVE | FLAG | CANCEL"),
    reason: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Administrative override / resolution of an unresolved or flagged trip session."""
    session = db.scalar(select(TripSession).where(TripSession.session_id == session_id))
    if not session:
        raise HTTPException(404, "Trip session not found")

    action = action.upper()
    if action == "RESOLVE":  # officer late close (P11): the trip stays counted
        new_status = "COMPLETED"
        session.close_mode = session.close_mode or "officer"
    elif action == "FLAG":
        new_status = "FLAGGED"
    elif action == "CANCEL":
        new_status = "CANCELLED"
    else:
        raise HTTPException(400, "Action must be RESOLVE, FLAG, or CANCEL")

    before_status = session.status
    session.status = new_status
    session.closed_by = officer.id
    session.notes = f"Resolution by {officer.name}: {reason}"
    if not session.completed_at:
        session.completed_at = datetime.now(timezone.utc)

    log_line = LogLine(
        "ACT",
        "WARN",
        f"Trip session {session.trip_code} {before_status} -> {new_status} resolved by Officer {officer.name}. Reason: {reason}",
        {"session_id": session_id, "action": action, "officer": officer.name, "reason": reason},
    )
    rows = logbus.save(db, [log_line], source=session.source)  # shows in the run / console it belongs to
    db.commit()
    db.refresh(session)
    logbus.publish(rows)
    return session


@router.post("/trips/exit-verify", response_model=ExitVerifyOut)
def exit_verify(
    body: ExitVerifyIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Officer-assisted exit verification (Gate Console Exit Mode). Runs the same exit pipeline as a pole; the
    officer reads the plate, so the truck's registered FASTag and length stand in for those sensors. The GB RFID
    sticker and the QR are still checked."""
    from app.routers.gates import process_gate_event
    from app.schemas import GateEventIn

    plate = normalise_plate(body.truck_plate) if body.truck_plate else None
    truck = db.scalar(select(Truck).where(Truck.plate == plate)) if plate else None
    out = process_gate_event(db, body.gate, GateEventIn(
        direction="OUT", plate_read=body.truck_plate, fastag_read=truck.fastag_tag_id if truck else None,
        radar_length_m=truck.length_m if truck else None, rfid_sticker_uid=body.rfid_sticker_uid,
        rfid_sim_mode=body.sim_auth_mode, qr_token=body.qr_token, source=body.source,
        permit_id=body.permit_id,
    ))
    checks = out.trip_checks or []
    passed = out.trip_decision == "EXIT AUTHORIZED"
    return ExitVerifyOut(
        decision=out.trip_decision or "EXIT REJECTED",
        passed=passed,
        reasons=[c.detail for c in checks if c.status == "failed"],
        checks=checks,
        session=out.trip_session,
        quota_before=None,
        quota_after=out.quota_remaining,
        exit_movement_id=out.id,
    )


# ---------- Quotas ----------
@router.get("/quotas", response_model=list[VehicleQuotaOut])
def list_quotas(status: str | None = None, db: Session = Depends(get_db)):
    stmt = select(VehicleQuota).order_by(VehicleQuota.id.asc())
    if status:
        stmt = stmt.where(VehicleQuota.status == status.upper())
    return db.scalars(stmt).all()


@router.get("/quotas/{truck_id}", response_model=VehicleQuotaOut)
def get_quota(truck_id: int, db: Session = Depends(get_db)):
    quota = db.scalar(select(VehicleQuota).where(VehicleQuota.truck_id == truck_id).order_by(VehicleQuota.id.desc()).limit(1))
    if not quota:
        raise HTTPException(404, "Quota record not found for truck")
    return quota


@router.post("/quotas/{truck_id}/adjust", response_model=VehicleQuotaOut)
def adjust_quota(
    truck_id: int,
    body: QuotaAdjustIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Authorized adjustment of a truck's maximum trip quota limit with mandatory reason."""
    quota = db.scalar(select(VehicleQuota).where(VehicleQuota.truck_id == truck_id).order_by(VehicleQuota.id.desc()).limit(1).with_for_update())
    if not quota:
        raise HTTPException(404, "Quota record not found for truck")

    prev_max = quota.max_trips
    new_max = body.new_max
    delta = new_max - prev_max

    quota.max_trips = new_max
    quota.remaining_trips = max(0, new_max - quota.completed_trips)
    if quota.remaining_trips == 0:
        quota.status = "EXHAUSTED"
    elif quota.remaining_trips <= 5:
        quota.status = "LOW"
    else:
        quota.status = "AVAILABLE"

    adj = QuotaAdjustment(
        truck_id=truck_id,
        officer_id=officer.id,
        previous_max=prev_max,
        new_max=new_max,
        delta=delta,
        reason=body.reason,
    )
    db.add(adj)

    truck = db.scalar(select(Truck).where(Truck.id == truck_id))
    truck_label = truck.plate if truck else f"truck #{truck_id}"

    log_line = LogLine(
        "ACT",
        "INFO",
        f"Trip quota for {truck_label} adjusted {prev_max} -> {new_max} (delta: {delta:+d}) by Officer {officer.name}. Reason: {body.reason}",
        {"truck_id": truck_id, "prev_max": prev_max, "new_max": new_max, "delta": delta, "officer": officer.name},
    )
    rows = logbus.save(db, [log_line], source="trips_admin")
    db.commit()
    db.refresh(quota)
    logbus.publish(rows)
    return quota


@router.get("/quotas/{truck_id}/adjustments", response_model=list[QuotaAdjustmentOut])
def list_adjustments(truck_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(QuotaAdjustment)
        .where(QuotaAdjustment.truck_id == truck_id)
        .order_by(QuotaAdjustment.id.desc())
    )
    return db.scalars(stmt).all()
