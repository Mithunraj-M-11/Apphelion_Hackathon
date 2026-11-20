"""Simulator scenario runs: the simulator opens a run, posts gate events, then saves its scorecard here."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import SimRun
from app.schemas import SimRunCreate, SimRunFinish, SimRunOut

router = APIRouter(prefix="/api/sim-runs", tags=["simulator"])


@router.post("", response_model=SimRunOut, status_code=201)
def start_run(body: SimRunCreate, db: Session = Depends(get_db)):
    run = SimRun(suite=body.suite, identify_mode=body.identify_mode or settings.identify_mode, results=[])
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.put("/{run_id}", response_model=SimRunOut)
def finish_run(run_id: int, body: SimRunFinish, db: Session = Depends(get_db)):
    run = db.get(SimRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    for k, v in body.model_dump().items():
        setattr(run, k, v)
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


@router.get("", response_model=list[SimRunOut])
def list_runs(db: Session = Depends(get_db)):
    return db.scalars(select(SimRun).order_by(SimRun.id.desc())).all()


@router.get("/{run_id}", response_model=SimRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(SimRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run
