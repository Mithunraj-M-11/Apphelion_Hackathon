"""Read-only reference data: officers and contracts."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Contract, Officer
from app.schemas import ContractOut, OfficerOut

router = APIRouter(prefix="/api", tags=["reference"])


@router.get("/officers", response_model=list[OfficerOut])
def list_officers(db: Session = Depends(get_db)):
    return db.scalars(select(Officer).order_by(Officer.id)).all()


@router.get("/contracts", response_model=list[ContractOut])
def list_contracts(db: Session = Depends(get_db)):
    return db.scalars(select(Contract).order_by(Contract.id)).all()
