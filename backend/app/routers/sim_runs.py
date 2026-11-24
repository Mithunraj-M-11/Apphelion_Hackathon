"""Simulator scenario runs: the simulator opens a run, posts gate events, and saves its scorecard here (after every
story, so the dashboard shows progress). The dashboard can also start a suite: the backend launches the same
simulator script, which talks to this API over HTTP exactly like a gate pole."""

from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import SimRun
from app.schemas import SimRunCreate, SimRunFinish, SimRunOut, SimRunStart, SimSuiteOut
from app.services import cleanup, simproc

router = APIRouter(prefix="/api/sim-runs", tags=["simulator"])

SUITES = ("gate_cheats", "threat_coverage", "mixed_batch", "edge_resilience")


@router.get("/suites", response_model=list[SimSuiteOut])
def list_suites():
    """The suites the dashboard can run, read from the scenario files."""
    out = []
    for suite in SUITES:
        path = simproc.SIMULATOR_DIR / "scenarios" / f"{suite}.yaml"
        if not path.exists():
            continue
        spec = yaml.safe_load(path.read_text(encoding="utf-8"))
        out.append(SimSuiteOut(suite=suite, title=spec.get("title", suite), description=spec.get("description", ""),
                               stories=len(spec.get("scenarios", []))))
    return out


@router.post("/start", status_code=202)
def start_suite(body: SimRunStart):
    """Run a suite in the background (one at a time). The run appears in the list as soon as it starts."""
    if body.suite not in SUITES:
        raise HTTPException(404, f"Unknown suite {body.suite}")
    try:
        simproc.start([body.suite])
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"started": body.suite}


@router.delete("")
def clear_runs(db: Session = Depends(get_db)):
    """Delete every scenario run and its data (permits, gate events, passes, holds, alerts, logs). Gate console
    sessions, site runs and real gate data are not touched."""
    busy = simproc.busy()
    if busy:
        raise HTTPException(409, f"{busy} is still running")
    counts = cleanup.clear_source(db, "sim:")
    counts["runs"] = db.execute(delete(SimRun)).rowcount
    db.commit()
    return counts


@router.post("", response_model=SimRunOut, status_code=201)
def open_run(body: SimRunCreate, db: Session = Depends(get_db)):
    run = SimRun(suite=body.suite, identify_mode=body.identify_mode or settings.identify_mode, results=[])
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.put("/{run_id}", response_model=SimRunOut)
def save_run(run_id: int, body: SimRunFinish, db: Session = Depends(get_db)):
    """Save the scorecard so far; `finished` closes the run."""
    run = db.get(SimRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    for k, v in body.model_dump(exclude={"finished"}).items():
        setattr(run, k, v)
    if body.finished:
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
