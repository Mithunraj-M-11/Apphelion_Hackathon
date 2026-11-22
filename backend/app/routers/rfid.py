"""RFID sticker management API endpoints."""

from datetime import datetime, timedelta, timezone
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models.registry import Officer, Truck
from app.models.rfid import RfidSticker
from app.schemas import RfidIssueIn, RfidReplaceIn, RfidRevokeIn, RfidStickerOut
from app.services import logbus
from app.services.logbus import LogLine
from app.services.registry import record_history, snapshot

router = APIRouter(prefix="/api/rfid-stickers", tags=["rfid"])


@router.get("", response_model=list[RfidStickerOut])
def list_stickers(
    status: str | None = None,
    truck_id: int | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(RfidSticker).order_by(RfidSticker.id.desc())
    if status:
        stmt = stmt.where(RfidSticker.status == status.upper())
    if truck_id:
        stmt = stmt.where(RfidSticker.truck_id == truck_id)
    return db.scalars(stmt).all()


@router.get("/{sticker_id}", response_model=RfidStickerOut)
def get_sticker(sticker_id: int, db: Session = Depends(get_db)):
    sticker = db.scalar(select(RfidSticker).where(RfidSticker.id == sticker_id))
    if not sticker:
        raise HTTPException(404, "RFID sticker not found")
    return sticker


@router.post("/issue", response_model=RfidStickerOut, status_code=201)
def issue_sticker(
    body: RfidIssueIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Issue a new GB RFID sticker to an enrolled truck."""
    truck = db.scalar(select(Truck).where(Truck.id == body.truck_id))
    if not truck:
        raise HTTPException(404, "Truck not found")

    clean_uid = body.uid.strip().upper()
    existing = db.scalar(select(RfidSticker).where(RfidSticker.uid == clean_uid))
    if existing:
        raise HTTPException(409, f"Sticker UID '{clean_uid}' already issued")

    # Invalidate any existing active sticker for this truck
    active = db.scalar(
        select(RfidSticker).where(RfidSticker.truck_id == truck.id, RfidSticker.status == "ACTIVE")
    )
    if active:
        active.status = "REPLACED"

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=body.validity_days)
    key_hash = hashlib.sha256(f"gb_secret_key_{clean_uid}".encode()).hexdigest()

    sticker = RfidSticker(
        uid=clean_uid,
        truck_id=truck.id,
        status="ACTIVE",
        auth_key_hash=key_hash,
        issued_at=now,
        expires_at=expires_at,
        issued_by=officer.id,
    )
    db.add(sticker)
    db.flush()

    record_history(
        db,
        entity="rfid_sticker",
        entity_id=sticker.id,
        action="issue",
        officer=officer,
        reason=f"Issued GB RFID sticker {clean_uid} to {truck.plate}",
        after=snapshot(sticker),
    )
    log_line = LogLine(
        "ACT",
        "INFO",
        f"RFID sticker {clean_uid} issued to {truck.plate} by Officer {officer.name}.",
        {"uid": clean_uid, "truck_plate": truck.plate, "officer": officer.name},
    )
    rows = logbus.save(db, [log_line], source="rfid_admin")
    db.commit()
    db.refresh(sticker)
    logbus.publish(rows)
    return sticker


@router.post("/{sticker_id}/replace", response_model=RfidStickerOut)
def replace_sticker(
    sticker_id: int,
    body: RfidReplaceIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Replace an existing sticker (e.g. damaged, peeling, compromised) with a new sticker."""
    old_sticker = db.scalar(select(RfidSticker).where(RfidSticker.id == sticker_id))
    if not old_sticker:
        raise HTTPException(404, "Sticker not found")

    new_uid = body.new_uid.strip().upper()
    existing = db.scalar(select(RfidSticker).where(RfidSticker.uid == new_uid))
    if existing:
        raise HTTPException(409, f"New sticker UID '{new_uid}' is already registered")

    now = datetime.now(timezone.utc)
    key_hash = hashlib.sha256(f"gb_secret_key_{new_uid}".encode()).hexdigest()
    new_sticker = RfidSticker(
        uid=new_uid,
        truck_id=old_sticker.truck_id,
        status="ACTIVE",
        auth_key_hash=key_hash,
        issued_at=now,
        expires_at=old_sticker.expires_at,
        issued_by=officer.id,
    )
    db.add(new_sticker)
    db.flush()

    old_before = snapshot(old_sticker)
    old_sticker.status = "REPLACED"
    old_sticker.replaced_by_sticker_id = new_sticker.id

    record_history(
        db,
        entity="rfid_sticker",
        entity_id=old_sticker.id,
        action="replace",
        officer=officer,
        reason=body.reason,
        before=old_before,
        after=snapshot(old_sticker),
    )
    log_line = LogLine(
        "ACT",
        "INFO",
        f"RFID sticker {old_sticker.uid} replaced with {new_uid} by Officer {officer.name}. Reason: {body.reason}",
        {"old_uid": old_sticker.uid, "new_uid": new_uid, "officer": officer.name},
    )
    rows = logbus.save(db, [log_line], source="rfid_admin")
    db.commit()
    db.refresh(new_sticker)
    logbus.publish(rows)
    return new_sticker


@router.post("/{sticker_id}/revoke", response_model=RfidStickerOut)
def revoke_sticker(
    sticker_id: int,
    body: RfidRevokeIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Revoke an RFID sticker with mandatory reason."""
    sticker = db.scalar(select(RfidSticker).where(RfidSticker.id == sticker_id))
    if not sticker:
        raise HTTPException(404, "Sticker not found")

    before = snapshot(sticker)
    sticker.status = "REVOKED"
    sticker.revoked_at = datetime.now(timezone.utc)
    sticker.revoked_by = officer.id
    sticker.revocation_reason = body.reason

    record_history(
        db,
        entity="rfid_sticker",
        entity_id=sticker.id,
        action="revoke",
        officer=officer,
        reason=body.reason,
        before=before,
        after=snapshot(sticker),
    )
    log_line = LogLine(
        "ACT",
        "WARN",
        f"RFID sticker {sticker.uid} REVOKED by Officer {officer.name}. Reason: {body.reason}",
        {"uid": sticker.uid, "reason": body.reason, "officer": officer.name},
    )
    rows = logbus.save(db, [log_line], source="rfid_admin")
    db.commit()
    db.refresh(sticker)
    logbus.publish(rows)
    return sticker
