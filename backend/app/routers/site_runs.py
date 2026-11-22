"""Site-level simulation runs: the simulator opens a run, plays a whole contract period through the gates, then
saves the site report (GB ledger vs ground truth vs Vendor report) here."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SiteRun
from app.schemas import SiteRunCreate, SiteRunFinish, SiteRunOut

router = APIRouter(prefix="/api/site-runs", tags=["simulator"])


@router.post("", response_model=SiteRunOut, status_code=201)
def start_run(body: SiteRunCreate, db: Session = Depends(get_db)):
    run = SiteRun(**body.model_dump())
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.put("/{run_id}", response_model=SiteRunOut)
def finish_run(run_id: int, body: SiteRunFinish, db: Session = Depends(get_db)):
    run = db.get(SiteRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    if body.permit_id is not None:
        run.permit_id = body.permit_id
    run.report = body.report
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


@router.get("", response_model=list[SiteRunOut])
def list_runs(db: Session = Depends(get_db)):
    return db.scalars(select(SiteRun).order_by(SiteRun.id.desc())).all()


@router.get("/{run_id}", response_model=SiteRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(SiteRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run
