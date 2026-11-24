from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.routers import (edge, gates, logs, permits, reference, rfid, sim_runs, sim_staging, site_runs, transporters,
                         trips, trucks, wim)

app = FastAPI(title="Aphelion GB Monitoring API", version="0.1.0")

app.include_router(reference.router)
app.include_router(transporters.router)
app.include_router(trucks.router)
app.include_router(gates.router)
app.include_router(sim_runs.router)
app.include_router(sim_staging.router)
app.include_router(site_runs.router)
app.include_router(logs.router)
app.include_router(permits.router)
app.include_router(rfid.router)
app.include_router(trips.router)
app.include_router(edge.router)
app.include_router(wim.router)

# Uploaded files (optional truck photos), from the persistent uploads volume
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
app.mount("/api/files", StaticFiles(directory=settings.upload_dir), name="files")


@app.get("/api/health")
def health() -> dict:
    """Liveness + database connectivity check."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as exc:  # report, don't crash the health endpoint
        db_status = f"error: {exc.__class__.__name__}"
    return {"status": "ok", "database": db_status}
