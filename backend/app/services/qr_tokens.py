"""Internal GB trip authorization QR token service.

Generates and verifies tamper-evident, cryptographically signed internal QR tokens
bound to one truck, one GB RFID sticker, and one active trip session.
Uses HMAC-SHA256 digital signatures with the site authority secret key.
"""

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
from typing import Any

from app.config import settings

# PoC signing secret (derived from settings or fallback secure string)
SIGNING_SECRET = getattr(settings, "secret_key", "sitewatch-gb-internal-authorization-secret-2026")


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding < 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def generate_trip_token(
    session_id: str,
    trip_code: str,
    truck_id: int,
    truck_plate: str,
    sticker_uid: str,
    expires_at: datetime,
) -> tuple[str, str]:
    """Generate signed authorization token string and its SHA-256 hash.

    Returns: (signed_token_string, token_hash)
    """
    issued_at = datetime.now(timezone.utc)
    payload = {
        "ver": "1.0",
        "typ": "GB_INTERNAL_TRIP_AUTH",
        "sid": session_id,
        "trip": trip_code,
        "tid": truck_id,
        "plate": truck_plate,
        "suid": sticker_uid,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64encode(payload_json)

    sig = hmac.new(SIGNING_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = _b64encode(sig)

    token = f"{payload_b64}.{sig_b64}"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return token, token_hash


def verify_trip_token(token: str) -> tuple[bool, str, dict[str, Any] | None]:
    """Verify digital signature, structure, and expiration of a trip token.

    Returns: (is_valid, reason, payload_dict)
    """
    if not token or "." not in token:
        return False, "Malformed or empty token format", None

    parts = token.strip().split(".")
    if len(parts) != 2:
        return False, "Token structure invalid (must contain header.signature)", None

    payload_b64, sig_b64 = parts[0], parts[1]

    # Verify HMAC-SHA256 signature
    expected_sig = hmac.new(SIGNING_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    expected_sig_b64 = _b64encode(expected_sig)

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return False, "Cryptographic signature verification failed (tampered token)", None

    try:
        payload_bytes = _b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as exc:
        return False, f"Invalid token payload encoding: {exc}", None

    now = int(datetime.now(timezone.utc).timestamp())
    exp = payload.get("exp", 0)
    if now > exp:
        return False, f"Token expired at {datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()}", payload

    return True, "Token signature valid and active", payload
