from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Officer


def acting_officer(
    x_officer_id: int = Header(..., description="ID of the GB officer making the change (no login in the PoC)"),
    db: Session = Depends(get_db),
) -> Officer:
    """Every write is attributed to a GB officer, chosen in the dashboard's 'acting as' dropdown."""
    officer = db.get(Officer, x_officer_id)
    if officer is None or not officer.active:
        raise HTTPException(status_code=403, detail="Unknown or inactive officer")
    return officer
