from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models import Driver, Officer, Transporter, Truck
from app.schemas import DriverIn, DriverOut, TransporterIn, TransporterOut, TransporterUpdate
from app.services.registry import diff, record_history, snapshot

router = APIRouter(prefix="/api/transporters", tags=["transporters"])


def _out(db: Session, t: Transporter) -> TransporterOut:
    count = db.scalar(select(func.count()).select_from(Truck).where(Truck.transporter_id == t.id)) or 0
    return TransporterOut.model_validate(t).model_copy(update={"truck_count": count})


def _get(db: Session, transporter_id: int) -> Transporter:
    t = db.get(Transporter, transporter_id)
    if t is None:
        raise HTTPException(404, "Transporter not found")
    return t


@router.get("", response_model=list[TransporterOut])
def list_transporters(db: Session = Depends(get_db)):
    return [_out(db, t) for t in db.scalars(select(Transporter).order_by(Transporter.name)).all()]


@router.get("/{transporter_id}", response_model=TransporterOut)
def get_transporter(transporter_id: int, db: Session = Depends(get_db)):
    return _out(db, _get(db, transporter_id))


@router.post("", response_model=TransporterOut, status_code=201)
def create_transporter(
    body: TransporterIn, db: Session = Depends(get_db), officer: Officer = Depends(acting_officer)
):
    t = Transporter(**body.model_dump())
    db.add(t)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A transporter with this name or GSTIN already exists")
    record_history(db, entity="transporter", entity_id=t.id, action="create", officer=officer, after=snapshot(t))
    db.commit()
    return _out(db, t)


@router.patch("/{transporter_id}", response_model=TransporterOut)
def update_transporter(
    transporter_id: int,
    body: TransporterUpdate,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    t = _get(db, transporter_id)
    before = snapshot(t)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A transporter with this name or GSTIN already exists")
    b, a = diff(before, snapshot(t))
    if a:
        record_history(db, entity="transporter", entity_id=t.id, action="update", officer=officer, before=b, after=a)
    db.commit()
    return _out(db, t)


@router.get("/{transporter_id}/drivers", response_model=list[DriverOut])
def list_drivers(transporter_id: int, db: Session = Depends(get_db)):
    return _get(db, transporter_id).drivers


@router.post("/{transporter_id}/drivers", response_model=DriverOut, status_code=201)
def add_driver(
    transporter_id: int,
    body: DriverIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    _get(db, transporter_id)
    d = Driver(transporter_id=transporter_id, **body.model_dump())
    db.add(d)
    db.flush()
    record_history(db, entity="driver", entity_id=d.id, action="create", officer=officer, after=snapshot(d))
    db.commit()
    return d
