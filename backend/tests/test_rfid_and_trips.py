from datetime import date, datetime, timedelta, timezone
import hashlib

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    Contract,
    Officer,
    RfidSticker,
    Transporter,
    TripSession,
    Truck,
    VehicleQuota,
)
from app.services.identify import Decision
from app.services.qr_tokens import generate_trip_token, verify_trip_token
from app.services.rfid_auth import (
    authenticate_sticker,
    compute_expected_response,
    generate_challenge,
)
from app.services.trip_authorization import evaluate_entry_authorization
from app.services.trip_sessions import create_trip_session, verify_and_complete_exit
from app.services.edge_recovery import (
    generate_recovery_snapshot,
    get_edge_state,
    update_edge_state,
    verify_snapshot_integrity,
)


@pytest.fixture
def db_session():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def test_rfid_authentication_genuine(db_session: Session):
    # Find a truck with an active sticker from seed data
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "ACTIVE"))
    assert sticker is not None
    res = authenticate_sticker(db_session, sticker.uid, sim_auth_mode="genuine")
    assert res.authenticated is True
    assert res.status == "PASSED"
    assert res.sticker.id == sticker.id


def test_rfid_authentication_cloned(db_session: Session):
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "ACTIVE"))
    assert sticker is not None
    res = authenticate_sticker(db_session, sticker.uid, sim_auth_mode="cloned")
    assert res.authenticated is False
    assert res.status == "FAILED"
    assert "cloned or counterfeit" in res.detail


def test_rfid_authentication_revoked(db_session: Session):
    # OD02BQ4410 was seeded as revoked_sticker
    revoked_sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.status == "REVOKED"))
    assert revoked_sticker is not None
    res = authenticate_sticker(db_session, revoked_sticker.uid, sim_auth_mode="genuine")
    assert res.authenticated is False
    assert res.status == "FAILED"
    assert "REVOKED" in res.detail


def test_rfid_authentication_unknown(db_session: Session):
    res = authenticate_sticker(db_session, "GB-RFID-NONEXISTENT", sim_auth_mode="genuine")
    assert res.authenticated is False
    assert res.status == "FAILED"
    assert "unknown or damaged" in res.detail


def test_qr_token_signing_and_verification():
    now = datetime.now(timezone.utc)
    token, token_hash = generate_trip_token(
        session_id="SES-TEST12345",
        trip_code="TRIP-2026-TEST01",
        truck_id=1,
        truck_plate="OD09AC5678",
        sticker_uid="GB-RFID-00001",
        expires_at=now + timedelta(hours=12),
    )
    assert token and token_hash
    is_valid, msg, payload = verify_trip_token(token)
    assert is_valid is True
    assert payload["trip"] == "TRIP-2026-TEST01"
    assert payload["plate"] == "OD09AC5678"

    # Tampered token
    tampered = token[:-4] + "AAAA"
    is_valid_t, msg_t, _ = verify_trip_token(tampered)
    assert is_valid_t is False
    assert "signature verification failed" in msg_t


def test_entry_authorization_success(db_session: Session):
    truck = db_session.scalar(select(Truck).where(Truck.plate == "OD09AC5678"))
    assert truck is not None
    # Ensure any residual active sessions from previous runs are completed
    residual = db_session.scalars(
        select(TripSession).where(
            TripSession.truck_id == truck.id,
            TripSession.status.in_(["ACTIVE", "AWAITING_ENTRY_CONFIRMATION", "EXPIRED_UNRESOLVED"])
        )
    ).all()
    for s in residual:
        s.status = "COMPLETED"
    db_session.commit()

    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.truck_id == truck.id))

    identify_dec = Decision(
        result="AUTHORISED",
        truck=truck,
        plate_normalised=truck.plate,
        checks=[],
        caught_by=[],
        reasons=[],
        flags=[],
    )

    auth_dec = evaluate_entry_authorization(
        db_session,
        identify_dec,
        sticker_uid=sticker.uid,
        sim_auth_mode="genuine",
    )
    assert auth_dec.decision == "ENTRY AUTHORIZED"
    assert auth_dec.passed is True
    assert len(auth_dec.checks) == 8


def test_entry_authorization_blocked_by_active_trip(db_session: Session):
    truck = db_session.scalar(select(Truck).where(Truck.plate == "OD09AB1234"))
    assert truck is not None
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.truck_id == truck.id))

    # Create active session
    session = create_trip_session(db_session, truck, sticker, entry_gate="G1")

    identify_dec = Decision(
        result="AUTHORISED",
        truck=truck,
        plate_normalised=truck.plate,
        checks=[],
        caught_by=[],
        reasons=[],
        flags=[],
    )

    auth_dec = evaluate_entry_authorization(
        db_session,
        identify_dec,
        sticker_uid=sticker.uid,
        sim_auth_mode="genuine",
    )
    assert auth_dec.decision == "ENTRY REJECTED"
    assert auth_dec.passed is False
    assert any("Active trip already exists" in r for r in auth_dec.reasons)

    # Clean up test session
    db_session.delete(session)
    db_session.commit()


def test_entry_authorization_blocked_by_quota_exhausted(db_session: Session):
    # OD11CE3305 was seeded with exhausted quota
    truck = db_session.scalar(select(Truck).where(Truck.plate == "OD11CE3305"))
    assert truck is not None
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.truck_id == truck.id))

    identify_dec = Decision(
        result="AUTHORISED",
        truck=truck,
        plate_normalised=truck.plate,
        checks=[],
        caught_by=[],
        reasons=[],
        flags=[],
    )

    auth_dec = evaluate_entry_authorization(
        db_session,
        identify_dec,
        sticker_uid=sticker.uid,
        sim_auth_mode="genuine",
    )
    assert auth_dec.decision == "ENTRY REJECTED"
    assert any("quota exhausted" in r.lower() for r in auth_dec.reasons)


def test_exit_verification_and_quota_deduction(db_session: Session):
    truck = db_session.scalar(select(Truck).where(Truck.plate == "OD09AD0090"))
    assert truck is not None
    sticker = db_session.scalar(select(RfidSticker).where(RfidSticker.truck_id == truck.id))

    # 1. Create entry session
    session = create_trip_session(db_session, truck, sticker, entry_gate="G1")
    assert session.status == "ACTIVE"

    # Fetch quota before
    quota = db_session.scalar(select(VehicleQuota).where(VehicleQuota.truck_id == truck.id))
    q_before = quota.remaining_trips

    # 2. Exit verification
    exit_res = verify_and_complete_exit(
        db=db_session,
        gate="G1",
        truck_plate=truck.plate,
        sticker_uid=sticker.uid,
        qr_token=session.signed_token,
        sim_auth_mode="genuine",
    )
    assert exit_res.decision == "EXIT AUTHORIZED"
    assert exit_res.passed is True
    assert exit_res.quota_after == q_before - 1

    # Session status must be COMPLETED
    db_session.refresh(session)
    assert session.status == "COMPLETED"

    # 3. Duplicate exit request should be rejected (no double quota deduction!)
    exit_res_dup = verify_and_complete_exit(
        db=db_session,
        gate="G1",
        truck_plate=truck.plate,
        sticker_uid=sticker.uid,
        qr_token=session.signed_token,
        sim_auth_mode="genuine",
    )
    assert exit_res_dup.decision == "EXIT REJECTED"
    assert exit_res_dup.passed is False
    db_session.refresh(quota)
    assert quota.remaining_trips == q_before - 1  # Still deducted once!

    # Clean up test session
    db_session.delete(session)
    db_session.commit()


def test_recovery_snapshot_generation_and_integrity(db_session: Session):
    snapshot_env = generate_recovery_snapshot(db_session)
    assert snapshot_env["format"] == "SITEWATCH_DISASTER_RECOVERY_SNAPSHOT"
    is_valid, msg, data = verify_snapshot_integrity(snapshot_env)
    assert is_valid is True
    assert len(data["trucks"]) >= 1
    assert len(data["rfid_stickers"]) >= 1
    assert len(data["quotas"]) >= 1
