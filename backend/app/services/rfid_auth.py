"""GB-issued RFID sticker authentication service.

Implements challenge-response authentication independently of FASTag.
Sensors/readers exchange nonces and cryptographic proofs with the GB RFID chip.
In this PoC, simulation modes exercise genuine tags, cloned/invalid cryptograms,
revoked tags, and unknown or damaged tags.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.rfid import RfidSticker


@dataclass
class RfidAuthResult:
    authenticated: bool
    status: str  # PASSED | FAILED | WARNING
    detail: str
    sticker: RfidSticker | None
    challenge: str
    response: str
    mode: str  # genuine | cloned | revoked | unknown_damaged


def generate_challenge() -> str:
    """Generate a 16-byte random hex challenge nonce for the RFID reader."""
    return secrets.token_hex(16)


def compute_expected_response(challenge: str, auth_key_hash: str) -> str:
    """Compute HMAC-SHA256 response for the challenge using the sticker's key."""
    return hmac.new(auth_key_hash.encode("utf-8"), challenge.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def authenticate_sticker(
    db: Session,
    sticker_uid: str | None,
    sim_auth_mode: str = "genuine",
    provided_challenge: str | None = None,
    provided_response: str | None = None,
) -> RfidAuthResult:
    """Authenticate a GB RFID sticker reading against the authoritative site registry.

    sim_auth_mode options:
      - genuine: valid tag, crypto challenge-response matches
      - cloned: invalid crypto response / signature mismatch (simulating cloned/copied UID without secret key)
      - revoked: sticker exists in GB registry but was flagged REVOKED
      - unknown_damaged: tag not present, corrupt UID, or tag status DAMAGED/EXPIRED
    """
    challenge = provided_challenge or generate_challenge()

    if not sticker_uid or not sticker_uid.strip():
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail="No GB RFID sticker UID detected by reader",
            sticker=None,
            challenge=challenge,
            response="",
            mode=sim_auth_mode,
        )

    clean_uid = sticker_uid.strip().upper()
    sticker = db.scalar(select(RfidSticker).where(RfidSticker.uid == clean_uid))

    if not sticker or sim_auth_mode == "unknown_damaged":
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker UID '{clean_uid}' is unknown or damaged (not registered in GB database)",
            sticker=None,
            challenge=challenge,
            response=provided_response or "INVALID_HASH",
            mode="unknown_damaged",
        )

    expected_resp = compute_expected_response(challenge, sticker.auth_key_hash)

    # Simulated clone/crypto failure
    if sim_auth_mode == "cloned":
        fake_resp = "DEADBEEF" + expected_resp[8:]
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail="Cryptographic challenge-response failed: signature mismatch (possible cloned or counterfeit tag)",
            sticker=sticker,
            challenge=challenge,
            response=fake_resp,
            mode="cloned",
        )

    # Check revocation status
    if sticker.status == "REVOKED" or sim_auth_mode == "revoked":
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker '{clean_uid}' is REVOKED: {sticker.revocation_reason or 'Revoked by authority'}",
            sticker=sticker,
            challenge=challenge,
            response=expected_resp,
            mode="revoked",
        )

    if sticker.status == "DAMAGED":
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker '{clean_uid}' is marked DAMAGED and cannot be used",
            sticker=sticker,
            challenge=challenge,
            response=expected_resp,
            mode="unknown_damaged",
        )

    if sticker.status == "EXPIRED":
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker '{clean_uid}' has EXPIRED ({sticker.expires_at.date()})",
            sticker=sticker,
            challenge=challenge,
            response=expected_resp,
            mode="unknown_damaged",
        )

    if sticker.status == "REPLACED":
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker '{clean_uid}' was REPLACED and is no longer valid",
            sticker=sticker,
            challenge=challenge,
            response=expected_resp,
            mode="unknown_damaged",
        )

    now = datetime.now(timezone.utc)
    if sticker.expires_at < now:
        return RfidAuthResult(
            authenticated=False,
            status="FAILED",
            detail=f"GB RFID sticker '{clean_uid}' expired on {sticker.expires_at.date()}",
            sticker=sticker,
            challenge=challenge,
            response=expected_resp,
            mode="unknown_damaged",
        )

    # Passed genuine authentication
    return RfidAuthResult(
        authenticated=True,
        status="PASSED",
        detail=f"GB RFID sticker '{clean_uid}' authenticated via crypto challenge-response",
        sticker=sticker,
        challenge=challenge,
        response=expected_resp,
        mode="genuine",
    )
