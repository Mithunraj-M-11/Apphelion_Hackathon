"""Edge infrastructure failover, snapshot disaster recovery, and reconciliation API."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models.edge import EdgeSystemState, EmergencyMovement
from app.models.registry import Officer
from app.schemas import (
    EdgeStateOut,
    EdgeStateUpdate,
    EmergencyMovementIn,
    EmergencyMovementOut,
    SnapshotRestoreIn,
)
from app.services.edge_recovery import (
    generate_recovery_snapshot,
    get_edge_state,
    reconcile_emergency_movements,
    record_emergency_movement,
    restore_disaster_recovery_snapshot,
    update_edge_state,
)

router = APIRouter(prefix="/api/edge", tags=["edge"])


@router.get("/state", response_model=EdgeStateOut)
def read_edge_state(db: Session = Depends(get_db)):
    return get_edge_state(db)


@router.post("/state", response_model=EdgeStateOut)
def mutate_edge_state(
    body: EdgeStateUpdate,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Simulate failover or mutate edge infrastructure state."""
    return update_edge_state(
        db=db,
        active_authority=body.active_authority,
        primary_status=body.primary_status,
        standby_status=body.standby_status,
        wan_connectivity=body.wan_connectivity,
        disaster_recovery_mode=body.disaster_recovery_mode,
        officer_id=officer.id,
    )


@router.post("/snapshot")
def create_snapshot(
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Generate and return an encrypted, digitally signed authorization snapshot."""
    return generate_recovery_snapshot(db, officer_id=officer.id)


@router.post("/restore")
def restore_snapshot(
    body: SnapshotRestoreIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Restore authorization state from a verified snapshot with officer approval."""
    try:
        return restore_disaster_recovery_snapshot(
            db=db,
            snapshot_envelope=body.snapshot_envelope,
            officer_id=officer.id,
            approval_reason=body.approval_reason,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/emergency-movement", response_model=EmergencyMovementOut, status_code=201)
def emergency_movement(
    body: EmergencyMovementIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Record an emergency vehicle movement during disaster recovery or offline outage."""
    em = record_emergency_movement(
        db=db,
        truck_plate=body.truck_plate,
        direction=body.direction,
        gate=body.gate,
        officer_id=officer.id,
        reason=body.reason,
    )
    return em


@router.get("/emergency-movements", response_model=list[EmergencyMovementOut])
def list_emergency_movements(db: Session = Depends(get_db)):
    return db.scalars(select(EmergencyMovement).order_by(EmergencyMovement.id.desc())).all()


@router.post("/reconcile")
def reconcile(
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Reconcile emergency movements against authoritative registry after system restoration."""
    return reconcile_emergency_movements(db, officer_id=officer.id)
