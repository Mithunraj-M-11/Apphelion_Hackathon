"""Site-level simulation runs: the simulator opens a run, plays a whole contract period through the gates, then
saves the site report (GB ledger vs ground truth vs Vendor report) here."""

from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Movement, SiteRun
from app.schemas import SiteRunCreate, SiteRunFinish, SiteRunOut, SiteRunStart, SiteScenarioOut
from app.services import cleanup, simproc

router = APIRouter(prefix="/api/site-runs", tags=["simulator"])


def _site_dir():
    return simproc.SIMULATOR_DIR / "scenarios" / "site"


@router.get("/scenarios", response_model=list[SiteScenarioOut])
def list_scenarios():
    """The site scenarios the dashboard can run, read from simulator/scenarios/site/."""
    out = []
    for path in sorted(_site_dir().glob("*.yaml")):
        cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        out.append(SiteScenarioOut(scenario=path.stem, description=cfg.get("description", ""),
                                   days=cfg.get("days", 7), fleet=cfg.get("fleet", 0),
                                   trip_limit=(cfg.get("permit") or {}).get("trip_limit")))
    return out


@router.post("/start", status_code=202)
def start_scenario(body: SiteRunStart):
    """Run a site scenario in the background (one simulator run at a time)."""
    if not (_site_dir() / f"{body.scenario}.yaml").exists():
        raise HTTPException(404, f"Unknown site scenario {body.scenario}")
    try:
        simproc.start(["site", body.scenario])
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"started": body.scenario}


@router.delete("")
def clear_runs(db: Session = Depends(get_db)):
    """Delete every site run and its data (permits, gate events, passes, holds, alerts, Vendor reports, logs).
    Gate console sessions, scenario runs and real gate data are not touched."""
    busy = simproc.busy()
    if busy:
        raise HTTPException(409, f"{busy} is still running")
    runs = db.execute(delete(SiteRun)).rowcount  # first: a run points at its permit
    counts = cleanup.clear_source(db, "site:")
    counts["runs"] = runs
    db.commit()
    return counts


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


def _out(db: Session, run: SiteRun) -> SiteRunOut:
    out = SiteRunOut.model_validate(run)
    if run.finished_at is None:  # progress while it is going
        out.gate_events_so_far = db.scalar(select(func.count()).select_from(Movement).where(
            Movement.source == f"site:{run.id}")) or 0
    return out


@router.get("", response_model=list[SiteRunOut])
def list_runs(db: Session = Depends(get_db)):
    return [_out(db, r) for r in db.scalars(select(SiteRun).order_by(SiteRun.id.desc())).all()]


@router.get("/{run_id}", response_model=SiteRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(SiteRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return _out(db, run)
