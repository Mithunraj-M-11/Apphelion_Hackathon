from fastapi import FastAPI
from sqlalchemy import text

from app.db import engine

app = FastAPI(title="Aphelion GB Monitoring API", version="0.1.0")


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
