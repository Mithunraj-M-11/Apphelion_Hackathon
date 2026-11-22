"""GB RFID sticker, trip sessions, per-vehicle allocation and edge recovery, through the unified gate pipeline.

Needs the seeded database (stickers GB-RFID-<truck id>, OD02BQ4410's sticker revoked). Each test uses its own
test permit (source 'test:...'), so tests never touch the real permit or each other.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Contract, Permit, RfidSticker, TripSession, Truck, VehicleQuota
from app.routers.gates import process_gate_event
from app.schemas import GateEventIn
from app.services.edge_recovery import generate_recovery_snapshot, verify_snapshot_integrity
from app.services.rfid_auth import authenticate_sticker

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def db_session():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def _permit(db: Session, **over) -> Permit:
    contract = db.scalar(select(Contract).order_by(Contract.id))
    today = datetime.now(IST).date()
    p = Permit(contract_id=contract.id, label="pytest", valid_from=today - timedelta(days=1),
               valid_to=today + timedelta(days=1), trip_limit=50, tonne_limit=1500, vehicle_limit=20,
               hours_start=time(0, 0), hours_end=time(23, 59), exit_grace_min=30, pass_expiry_min=120,
               source=f"test:{uuid.uuid4().hex[:8]}", **over)
    db.add(p)
    db.commit()
    return p


def _event(db: Session, permit: Permit, plate: str, direction: str, *, minutes: int = 0, sticker: str | None = "own",
           mode: str = "genuine", token: str | None = None, load_t: float = 0.0):
    truck = db.scalar(select(Truck).where(Truck.plate == plate))
    uid = None
    if sticker == "own":
        uid = db.scalar(select(RfidSticker.uid).where(RfidSticker.truck_id == truck.id))
    elif sticker is not None:
        uid = sticker
    at = datetime.now(IST).replace(hour=8, minute=0, second=0, microsecond=0) + timedelta(minutes=minutes)
    return process_gate_event(db, "G1", GateEventIn(
        direction=direction, plate_read=truck.plate, fastag_read=truck.fastag_tag_id,
        radar_length_m=truck.length_m, weight_t=round(truck.empty_weight_t + load_t, 2), observed_at=at,
        rfid_sticker_uid=uid, rfid_sim_mode=mode, pass_token=token, permit_id=permit.id, source=permit.source,
    ))


def codes(out) -> list[str]:
    return [a.code for a in out.alerts]


# ---------------------------------------------------------------- sticker authentication (unit)
def test_rfid_authentication_genuine(db_session: Session):
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "ACTIVE"))
    res = authenticate_sticker(db_session, sticker.uid, sim_auth_mode="genuine")
    assert res.authenticated is True and res.status == "PASSED" and res.sticker.id == sticker.id


def test_rfid_authentication_cloned(db_session: Session):
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "ACTIVE"))
    res = authenticate_sticker(db_session, sticker.uid, sim_auth_mode="cloned")
    assert res.authenticated is False and "cloned or counterfeit" in res.detail


def test_rfid_authentication_revoked(db_session: Session):
    revoked = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "REVOKED"))
    res = authenticate_sticker(db_session, revoked.uid, sim_auth_mode="genuine")
    assert res.authenticated is False and "REVOKED" in res.detail


def test_rfid_authentication_unknown(db_session: Session):
    res = authenticate_sticker(db_session, "GB-RFID-NONEXISTENT", sim_auth_mode="genuine")
    assert res.authenticated is False and "unknown or damaged" in res.detail


# ---------------------------------------------------------------- entry / exit through the gate pipeline
def test_entry_authorized_issues_signed_pass_bound_to_sticker(db_session: Session):
    p = _permit(db_session)
    out = _event(db_session, p, "OD09AC5678", "IN")
    assert out.trip_decision == "ENTRY AUTHORIZED" and out.barrier == "up"
    assert out.issued_pass is not None and out.trip_session.sticker_id is not None
    assert out.trip_session.status == "ACTIVE" and out.issued_pass.sms_code


def test_entry_refused_without_sticker(db_session: Session):
    p = _permit(db_session)
    out = _event(db_session, p, "OD09AC5678", "IN", sticker=None)
    assert out.trip_decision == "ENTRY REJECTED" and "RFID_MISSING" in codes(out)


def test_entry_refused_with_cloned_sticker_and_truck_held(db_session: Session):
    p = _permit(db_session)
    out = _event(db_session, p, "OD09AC5678", "IN", mode="cloned")
    assert out.barrier == "down" and "RFID_CLONED" in codes(out)
    again = _event(db_session, p, "OD09AC5678", "IN", minutes=10)  # even the genuine one now waits for review
    assert "TRUCK_ON_HOLD" in codes(again)


def test_entry_refused_with_sticker_of_another_truck(db_session: Session):
    p = _permit(db_session)
    other = db_session.scalar(select(Truck).where(Truck.plate == "OD09AE4521"))
    uid = db_session.scalar(select(RfidSticker.uid).where(RfidSticker.truck_id == other.id))
    out = _event(db_session, p, "OD09AC5678", "IN", sticker=uid)
    assert out.barrier == "down" and "RFID_MISMATCH" in codes(out)


def test_entry_refused_with_revoked_sticker(db_session: Session):
    p = _permit(db_session)
    out = _event(db_session, p, "OD02BQ4410", "IN")  # seeded: sticker revoked
    assert out.barrier == "down" and "RFID_REVOKED" in codes(out)


def test_entry_blocked_by_active_trip(db_session: Session):
    p = _permit(db_session)
    _event(db_session, p, "OD09AB1234", "IN")
    out = _event(db_session, p, "OD09AB1234", "IN", minutes=15)
    assert out.trip_decision == "ENTRY REJECTED" and "CLONE_SUSPECT" in codes(out)


def test_per_vehicle_allocation_from_the_contract(db_session: Session):
    p = _permit(db_session, per_vehicle_trips=1)
    first = _event(db_session, p, "OD11CE3305", "IN")
    assert first.quota_max == 1 and first.quota_remaining == 0  # reserved at entry
    _event(db_session, p, "OD11CE3305", "OUT", minutes=40, token=first.issued_pass.token, load_t=20)
    second = _event(db_session, p, "OD11CE3305", "IN", minutes=60)
    assert second.barrier == "down" and "PER_VEHICLE_LIMIT" in codes(second)


def test_exit_closes_once_and_never_double_counts(db_session: Session):
    p = _permit(db_session, per_vehicle_trips=5)
    entry = _event(db_session, p, "OD09AD0090", "IN")
    token = entry.issued_pass.token
    out = _event(db_session, p, "OD09AD0090", "OUT", minutes=45, token=token, load_t=20)
    assert out.trip_decision == "EXIT AUTHORIZED" and out.trip == "LEGAL"
    assert out.trip_session.status == "COMPLETED" and out.trip_session.net_t is not None
    dup = _event(db_session, p, "OD09AD0090", "OUT", minutes=60, token=token, load_t=20)
    assert dup.trip_decision == "EXIT REJECTED" and "PASS_REUSE" in codes(dup)
    quota = db_session.scalar(select(VehicleQuota).where(VehicleQuota.permit_id == p.id))
    assert quota.completed_trips == 1  # one trip, counted once


def test_exit_with_different_sticker_is_refused(db_session: Session):
    p = _permit(db_session)
    entry = _event(db_session, p, "OD09AF7733", "IN")
    other = db_session.scalar(select(Truck).where(Truck.plate == "OD09AG1180"))
    uid = db_session.scalar(select(RfidSticker.uid).where(RfidSticker.truck_id == other.id))
    out = _event(db_session, p, "OD09AF7733", "OUT", minutes=40, sticker=uid, token=entry.issued_pass.token,
                 load_t=20)
    assert out.barrier == "down" and "RFID_MISMATCH" in codes(out)


def test_expired_pass_is_swept_and_needs_an_officer(db_session: Session):
    p = _permit(db_session)
    entry = _event(db_session, p, "OD09AH2468", "IN")
    out = _event(db_session, p, "OD09AH2468", "OUT", minutes=150, token=entry.issued_pass.token, load_t=20)
    assert out.barrier == "down" and "PASS_EXPIRED_AT_EXIT" in codes(out)
    sess = db_session.scalar(select(TripSession).where(TripSession.trip_code == entry.issued_pass.code))
    db_session.refresh(sess)
    assert sess.status == "EXPIRED_UNRESOLVED"
    back = _event(db_session, p, "OD09AH2468", "IN", minutes=170)
    assert "UNRESOLVED_TRIP" in codes(back)


# ---------------------------------------------------------------- edge recovery
def test_recovery_snapshot_generation_and_integrity(db_session: Session):
    snapshot_env = generate_recovery_snapshot(db_session)
    assert snapshot_env["format"] == "SITEWATCH_DISASTER_RECOVERY_SNAPSHOT"
    is_valid, msg, data = verify_snapshot_integrity(snapshot_env)
    assert is_valid is True
    assert len(data["trucks"]) >= 1 and len(data["rfid_stickers"]) >= 1
    assert "quotas" in data
