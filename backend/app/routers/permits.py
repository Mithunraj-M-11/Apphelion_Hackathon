"""Permits (contract limits) with their live ledger, alerts, and truck holds."""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models import Alert, Contract, Officer, Permit, Survey, TruckHold, VendorReport
from app.schemas import AlertOut, HoldOut, HoldRelease, PermitIn, PermitOut, VendorReportIn
from app.services import integrity, logbus, trip
from app.services import survey as survey_service
from app.services import report as report_service
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


@router.get("/permits/{permit_id}/report")
def get_report(permit_id: int, db: Session = Depends(get_db)) -> dict:
    """GB period report: the permit's period as the GB recorded it (gates, Vendor reports, surveys, equipment,
    officer actions, open items). Built only from the GB's own records, never from simulation ground truth."""
    return report_service.build(db, _permit(db, permit_id))


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


class SurveyIn(BaseModel):
    period_from: date
    period_to: date
    method: str = "drone_photogrammetry"  # drone_photogrammetry | drone_lidar | satellite_stereo
    volume_dug_m3: float = Field(ge=0)
    density_t_m3: float = Field(gt=0, lt=10)
    stockpile_change_t: float = 0.0
    outside_plan_m3: float = Field(default=0.0, ge=0)
    check_error_cm: float | None = Field(default=None, ge=0)


def _survey_out(s: Survey) -> dict:
    return {k: getattr(s, k) for k in ("id", "permit_id", "period_from", "period_to", "method", "volume_dug_m3",
                                       "density_t_m3", "stockpile_change_t", "outside_plan_m3", "check_error_cm",
                                       "status", "surveyed_out_t", "gates_out_t", "gap_pct", "officer_id")}


@router.post("/permits/{permit_id}/surveys", status_code=201)
def add_survey(permit_id: int, body: SurveyIn, db: Session = Depends(get_db),
               officer: Officer = Depends(acting_officer)) -> dict:
    """Mass balance (gap 7): a GB survey of the site for a period. Ore that left by the survey is compared with what
    the GB's gates weighed out; VOLUME_MISMATCH above 5%, VOLUME_TREND for a steady gap, EXTRACTION_OUTSIDE_PLAN."""
    permit = _permit(db, permit_id)
    s, alerts = survey_service.record(db, permit, **body.model_dump(), officer_id=officer.id)
    gap = f"{s.gap_pct:+.1f}%" if s.gap_pct is not None else "n/a"
    msg = (f"Survey {body.period_from} to {body.period_to} ({body.method}) rejected: check-pillar error "
           f"{body.check_error_cm} cm, fly again") if s.status == "rejected" else         (f"Survey {body.period_from} to {body.period_to}: {s.surveyed_out_t:,.0f} t left by the survey, gates weighed "
         f"{s.gates_out_t:,.0f} t, gap {gap}")
    lines = [LogLine("COMPARE", "INFO" if not alerts else "ALERT", msg)] +         [LogLine("ACT", trip.LEVEL[a.severity], f"{a.severity} {a.code}: {a.message}") for a in alerts]
    rows = logbus.save(db, lines, source=permit.source)
    db.commit()
    logbus.publish(rows)
    return {**_survey_out(s), "alerts": [a.code for a in alerts]}


@router.get("/permits/{permit_id}/surveys")
def list_surveys(permit_id: int, db: Session = Depends(get_db)) -> list[dict]:
    return [_survey_out(s) for s in db.scalars(select(Survey).where(Survey.permit_id == permit_id)
                                               .order_by(Survey.period_from)).all()]


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
