import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import acting_officer
from app.models import Officer, RegistryHistory, Transporter, Truck, TruckPhoto
from app.schemas import (
    HistoryOut,
    LookupOut,
    PhotoKind,
    StatusChange,
    TruckCreate,
    TruckListItem,
    TruckOut,
    TruckStatus,
    TruckUpdate,
)
from app.services.plates import normalise_plate, plate_type
from app.services.registry import compute_authorisation, diff, record_history, snapshot

router = APIRouter(prefix="/api/trucks", tags=["trucks"])

DUPLICATE_MSG = "Duplicate: plate, FASTag or chassis number already registered to another truck"


# ---------- helpers ----------
def _get(db: Session, truck_id: int) -> Truck:
    truck = db.get(Truck, truck_id)
    if truck is None:
        raise HTTPException(404, "Truck not found")
    return truck


def _list_item(truck: Truck) -> TruckListItem:
    return TruckListItem.model_validate(
        {
            "id": truck.id,
            "plate": truck.plate,
            "plate_type": truck.plate_type,
            "make": truck.make,
            "model": truck.model,
            "body_type": truck.body_type,
            "status": truck.status,
            "transporter": truck.transporter,
            "authorisation": compute_authorisation(truck),
        },
        from_attributes=True,
    )


def _out(truck: Truck) -> TruckOut:
    data = {c.name: getattr(truck, c.name) for c in Truck.__table__.columns}
    data.update(
        transporter=truck.transporter,
        contract=truck.contract,
        inspector=truck.inspector,
        approver=truck.approver,
        photos=[
            {"id": p.id, "kind": p.kind, "url": f"/api/files/{p.file_path}", "uploaded_at": p.uploaded_at}
            for p in truck.photos
        ],
        authorisation=compute_authorisation(truck),
    )
    return TruckOut.model_validate(data, from_attributes=True)


def _check_refs(db: Session, transporter_id: int | None, approved_by: int | None) -> None:
    if transporter_id is not None and db.get(Transporter, transporter_id) is None:
        raise HTTPException(422, "Unknown transporter")
    if approved_by is not None:
        approver = db.get(Officer, approved_by)
        if approver is None or approver.role != "approver":
            raise HTTPException(422, "approved_by must be an officer with the approver role")


# ---------- read ----------
@router.get("", response_model=list[TruckListItem])
def list_trucks(
    q: str | None = Query(None, description="Search plate, make, model or FASTag"),
    status: TruckStatus | None = None,
    transporter_id: int | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Truck).order_by(Truck.plate)
    if q:
        like = f"%{normalise_plate(q) or q}%"
        stmt = stmt.where(
            or_(
                Truck.plate.ilike(like),
                Truck.make.ilike(f"%{q}%"),
                Truck.model.ilike(f"%{q}%"),
                Truck.fastag_tag_id.ilike(f"%{q}%"),
            )
        )
    if status:
        stmt = stmt.where(Truck.status == status)
    if transporter_id:
        stmt = stmt.where(Truck.transporter_id == transporter_id)
    return [_list_item(t) for t in db.scalars(stmt).all()]


@router.get("/lookup", response_model=LookupOut)
def lookup(
    plate: str | None = None,
    fastag: str | None = Query(None, description="FASTag tag ID or chip ID"),
    db: Session = Depends(get_db),
):
    """Look a gate reading up in the registry. Exact matches only: no fuzzy guessing."""
    if not plate and not fastag:
        raise HTTPException(422, "Give plate and/or fastag")
    plate_q = normalise_plate(plate) if plate else None
    by_plate = db.scalar(select(Truck).where(Truck.plate == plate_q)) if plate_q else None
    by_tag = (
        db.scalar(select(Truck).where(or_(Truck.fastag_tag_id == fastag, Truck.fastag_chip_id == fastag)))
        if fastag
        else None
    )
    same = by_plate.id == by_tag.id if (by_plate and by_tag) else None
    return LookupOut(
        plate_query=plate_q,
        fastag_query=fastag,
        by_plate=_list_item(by_plate) if by_plate else None,
        by_fastag=_list_item(by_tag) if by_tag else None,
        same_truck=same,
    )


@router.get("/{truck_id}", response_model=TruckOut)
def get_truck(truck_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, truck_id))


@router.get("/{truck_id}/history", response_model=list[HistoryOut])
def truck_history(truck_id: int, db: Session = Depends(get_db)):
    _get(db, truck_id)
    stmt = (
        select(RegistryHistory)
        .where(RegistryHistory.entity == "truck", RegistryHistory.entity_id == truck_id)
        .order_by(RegistryHistory.changed_at.desc(), RegistryHistory.id.desc())
    )
    return db.scalars(stmt).all()


# ---------- write ----------
@router.post("", response_model=TruckOut, status_code=201)
def create_truck(body: TruckCreate, db: Session = Depends(get_db), officer: Officer = Depends(acting_officer)):
    _check_refs(db, body.transporter_id, body.approved_by)
    now = datetime.now(timezone.utc)
    data = body.model_dump(exclude_none=True)
    truck = Truck(
        **data,
        plate_type=plate_type(body.plate),
        inspected_by=officer.id,
        inspected_at=now,
        approved_at=now if body.approved_by else None,
        vahan_checked_at=now if body.vahan_verified else None,
    )
    db.add(truck)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE_MSG)
    record_history(
        db, entity="truck", entity_id=truck.id, action="create", officer=officer,
        reason="Enrolled after physical inspection", after=snapshot(truck),
    )
    db.commit()
    db.refresh(truck)
    return _out(truck)


@router.patch("/{truck_id}", response_model=TruckOut)
def update_truck(
    truck_id: int, body: TruckUpdate, db: Session = Depends(get_db), officer: Officer = Depends(acting_officer)
):
    truck = _get(db, truck_id)
    changes = body.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    _check_refs(db, changes.get("transporter_id"), changes.get("approved_by"))
    before = snapshot(truck)
    for k, v in changes.items():
        setattr(truck, k, v)
    if changes.get("vahan_verified"):
        truck.vahan_checked_at = datetime.now(timezone.utc)
    if "approved_by" in changes and changes["approved_by"]:
        truck.approved_at = datetime.now(timezone.utc)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE_MSG)
    b, a = diff(before, snapshot(truck))
    if a:
        record_history(db, entity="truck", entity_id=truck.id, action="update", officer=officer,
                       reason=reason, before=b, after=a)
    db.commit()
    db.refresh(truck)
    return _out(truck)


@router.post("/{truck_id}/status", response_model=TruckOut)
def change_status(
    truck_id: int, body: StatusChange, db: Session = Depends(get_db), officer: Officer = Depends(acting_officer)
):
    """Suspend, hold, reactivate or retire. A reason is mandatory; trucks are never deleted."""
    truck = _get(db, truck_id)
    before = {"status": truck.status, "status_reason": truck.status_reason}
    truck.status = body.status
    truck.status_reason = body.reason
    record_history(db, entity="truck", entity_id=truck.id, action="status", officer=officer,
                   reason=body.reason, before=before, after={"status": body.status, "status_reason": body.reason})
    db.commit()
    db.refresh(truck)
    return _out(truck)


@router.post("/{truck_id}/photos", response_model=TruckOut, status_code=201)
def upload_photo(
    truck_id: int,
    kind: PhotoKind = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Optional photo. Stored in the persistent uploads volume."""
    truck = _get(db, truck_id)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "Only image files are accepted")
    ext = Path(file.filename or "").suffix.lower() or ".jpg"
    rel = Path(f"trucks/{truck.id}/{kind}_{uuid.uuid4().hex[:8]}{ext}")
    dest = Path(settings.upload_dir) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(file.file.read())
    photo = TruckPhoto(truck_id=truck.id, kind=kind, file_path=rel.as_posix())
    db.add(photo)
    db.flush()
    record_history(db, entity="truck", entity_id=truck.id, action="photo", officer=officer,
                   reason=f"Photo added: {kind}", after={"photo_id": photo.id, "kind": kind})
    db.commit()
    db.refresh(truck)
    return _out(truck)
