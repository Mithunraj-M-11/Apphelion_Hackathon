"""Permits (contract limits) with their live ledger, alerts, and truck holds."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models import Alert, Contract, Officer, Permit, TruckHold, VendorReport
from app.schemas import AlertOut, HoldOut, HoldRelease, PermitIn, PermitOut, VendorReportIn
from app.services import integrity, logbus, trip
from app.services.logbus import LogLine

router = APIRouter(prefix="/api", tags=["permits"])


@router.post("/permits", response_model=PermitOut, status_code=201)
def create_permit(body: PermitIn, db: Session = Depends(get_db),
                  x_officer_id: int | None = Header(None, description="Required for real (non-sim) permits")):
    """Real permits are entered by a GB officer. Simulator scenarios and Gate console sessions create their own
    source-tagged permits so their trips, passes and holds stay separate."""
    if body.source is None:
        officer = db.get(Officer, x_officer_id) if x_officer_id else None
        if officer is None or not officer.active:
            raise HTTPException(403, "A GB officer must create a real permit")
    if body.valid_to < body.valid_from:
        raise HTTPException(422, "valid_to is before valid_from")
    contract = db.scalar(select(Contract).order_by(Contract.id))
    if contract is None:
        raise HTTPException(409, "No contract configured")
    permit = Permit(contract_id=contract.id, **body.model_dump())
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return permit


@router.get("/permits", response_model=list[PermitOut])
def list_permits(origin: str | None = Query(None, description="real | sim | walkthrough | site"),
                 db: Session = Depends(get_db)):
    stmt = select(Permit).order_by(Permit.id.desc()).limit(200)
    if origin == "real":
        stmt = stmt.where(Permit.source.is_(None))
    elif origin in ("sim", "walkthrough", "site"):
        stmt = stmt.where(Permit.source.startswith(f"{origin}:"))
    return db.scalars(stmt).all()


def _permit(db: Session, permit_id: int) -> Permit:
    permit = db.get(Permit, permit_id)
    if permit is None:
        raise HTTPException(404, "Permit not found")
    return permit


@router.get("/permits/{permit_id}", response_model=PermitOut)
def get_permit(permit_id: int, db: Session = Depends(get_db)):
    return _permit(db, permit_id)


@router.get("/permits/{permit_id}/ledger")
def get_ledger(permit_id: int, db: Session = Depends(get_db)) -> dict:
    """Live Compare totals: permitted vs legal vs actual vs illegal, tonnes, vehicles, holds, alerts."""
    return trip.ledger(db, _permit(db, permit_id))


@router.get("/permits/{permit_id}/ledger/daily")
def get_daily_ledger(permit_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Per site day (IST): entries, passes issued, refusals, legal / actual / illegal trips, tonnes, alerts."""
    return trip.daily_ledger(db, _permit(db, permit_id))


@router.post("/permits/{permit_id}/vendor-reports", status_code=201)
def vendor_report(permit_id: int, body: VendorReportIn, db: Session = Depends(get_db)) -> dict:
    """The Vendor's claim for one day (CP9). Stored, then checked against the GB's own figures for that day; an
    under-report raises an alert. The Vendor's numbers are never used as the source."""
    permit = _permit(db, permit_id)
    db.add(VendorReport(permit_id=permit.id, day=body.day, trips=body.trips, tonnes=body.tonnes, source=permit.source))
    gb = next((d for d in trip.daily_ledger(db, permit) if d["day"] == body.day.isoformat()),
              {"legal_trips": 0, "actual_trips": 0, "tonnes": 0.0})
    found = trip.compare_vendor(body.trips, body.tonnes, gb["legal_trips"], gb["actual_trips"], gb["tonnes"])
    lines = [LogLine("COMPARE", "INFO", f"Vendor report {body.day}: {body.trips} trips, {body.tonnes:.1f} t; GB "
                                        f"{gb['legal_trips']} legal, {gb['actual_trips']} actual, {gb['tonnes']:.1f} t")]
    alerts = []
    for code, severity, message in found:
        db.add(Alert(permit_id=permit.id, code=code, severity=severity, message=f"{body.day}: {message}",
                     status="open", source=permit.source))
        alerts.append({"code": code, "severity": severity, "message": message})
        lines.append(LogLine("ACT", trip.LEVEL[severity], f"{severity} {code}: {message}"))
    rows = logbus.save(db, lines, source=permit.source)
    db.commit()
    logbus.publish(rows)
    return {"day": body.day.isoformat(), "claimed": {"trips": body.trips, "tonnes": body.tonnes},
            "gb": {"legal_trips": gb["legal_trips"], "actual_trips": gb["actual_trips"], "tonnes": gb["tonnes"]},
            "alerts": alerts}


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(
    permit_id: int | None = None,
    severity: str | None = None,
    origin: str | None = Query(None, description="real | sim | walkthrough | site"),
    limit: int = Query(300, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    stmt = select(Alert).order_by(Alert.id.desc()).limit(limit)
    if permit_id is not None:
        stmt = stmt.where(Alert.permit_id == permit_id)
    if severity:
        stmt = stmt.where(Alert.severity == severity.upper())
    if origin == "real":
        stmt = stmt.where(Alert.source.is_(None))
    elif origin in ("sim", "walkthrough", "site"):
        stmt = stmt.where(Alert.source.startswith(f"{origin}:"))
    return db.scalars(stmt).all()


@router.get("/permits/{permit_id}/verify-records")
def verify_records(permit_id: int, db: Session = Depends(get_db)) -> dict:
    """Record check (gap 5): recompute the hash chain over this permit's gate events. Any event edited or deleted
    after it was recorded breaks the chain and raises RECORD_TAMPERED."""
    permit = _permit(db, permit_id)
    report = integrity.verify(db, permit)
    db.commit()
    return report


@router.get("/holds", response_model=list[HoldOut])
def list_holds(permit_id: int | None = None, active: bool = True, db: Session = Depends(get_db)):
    stmt = select(TruckHold).order_by(TruckHold.id.desc())
    if permit_id is not None:
        stmt = stmt.where(TruckHold.permit_id == permit_id)
    if active:
        stmt = stmt.where(TruckHold.released_at.is_(None))
    return db.scalars(stmt).all()


@router.post("/holds/{hold_id}/release", response_model=HoldOut)
def release_hold(hold_id: int, body: HoldRelease, db: Session = Depends(get_db),
                 officer: Officer = Depends(acting_officer)):
    """An officer releases a held truck, with a reason. The hold row is kept (never deleted)."""
    hold = db.get(TruckHold, hold_id)
    if hold is None:
        raise HTTPException(404, "Hold not found")
    if hold.released_at is not None:
        raise HTTPException(409, "Hold already released")
    hold.released_at = datetime.now(timezone.utc)
    hold.released_by = officer.id
    hold.release_reason = body.reason
    permit = db.get(Permit, hold.permit_id)
    rows = logbus.save(db, [LogLine("ACT", "INFO", f"Hold on {hold.truck.plate} released by {officer.name}: "
                                                   f"{body.reason}")], source=permit.source if permit else None)
    db.commit()
    db.refresh(hold)
    logbus.publish(rows)
    return hold
