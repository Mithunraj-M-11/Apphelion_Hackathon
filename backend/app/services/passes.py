"""Trip pass cryptography: the GB signs every pass, so nobody else can make or edit one.

- QR content  = base64url(payload JSON) + "." + base64url(Ed25519 signature). Anyone with the GB public key can
  verify it; only the GB server (private key) can create one. Editing any character breaks the signature.
- SMS code    = 8 characters derived from the pass id with a GB-only secret (HMAC-SHA256, base32). Works on
  basic phones; checked by lookup.

Pure helpers (`sign_with`, `verify_with`, `code_with`) take the keys explicitly so they can be unit-tested; the
DB-backed wrappers load (or create on first use) the GB keys from `server_keys`.
"""

import base64
import hashlib
import hmac
import json
import secrets

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy.orm import Session

from app.models import ServerKey

SIGNING_KEY = "pass_ed25519"
SMS_SECRET = "pass_sms_hmac"
_cache: dict[str, object] = {}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


# ---------------------------------------------------------------- pure
def sign_with(key: Ed25519PrivateKey, payload: dict) -> str:
    body = canonical(payload)
    return f"{_b64(body)}.{_b64(key.sign(body))}"


def verify_with(public: Ed25519PublicKey, token: str) -> dict | None:
    """The payload if the signature is valid, else None (forged, edited or garbled)."""
    try:
        body_txt, sig_txt = token.strip().split(".")
        body = _unb64(body_txt)
        public.verify(_unb64(sig_txt), body)
        return json.loads(body)
    except (ValueError, InvalidSignature, json.JSONDecodeError):
        return None


def code_with(secret: bytes, pass_id: int) -> str:
    digest = hmac.new(secret, f"pass:{pass_id}".encode(), hashlib.sha256).digest()
    return base64.b32encode(digest).decode()[:8]


# ---------------------------------------------------------------- GB keys (DB-backed)
def _load(db: Session) -> tuple[Ed25519PrivateKey, bytes]:
    """Load the GB keys, creating them on first use in their own committed transaction (so a rolled-back
    gate event can never leave the server holding a key that isn't stored)."""
    if "key" in _cache:
        return _cache["key"], _cache["secret"]  # type: ignore[return-value]
    from app.db import SessionLocal

    with SessionLocal() as kdb:
        row = kdb.get(ServerKey, SIGNING_KEY)
        if row is None:
            pem = Ed25519PrivateKey.generate().private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            ).decode()
            row = ServerKey(name=SIGNING_KEY, value=pem)
            kdb.add(row)
        srow = kdb.get(ServerKey, SMS_SECRET)
        if srow is None:
            srow = ServerKey(name=SMS_SECRET, value=secrets.token_hex(32))
            kdb.add(srow)
        kdb.commit()
        pem_value, secret_hex = row.value, srow.value
    key = serialization.load_pem_private_key(pem_value.encode(), password=None)
    assert isinstance(key, Ed25519PrivateKey)
    _cache["key"], _cache["secret"] = key, bytes.fromhex(secret_hex)
    return key, bytes.fromhex(secret_hex)


def sign(db: Session, payload: dict) -> str:
    key, _ = _load(db)
    return sign_with(key, payload)


def verify(db: Session, token: str) -> dict | None:
    key, _ = _load(db)
    return verify_with(key.public_key(), token)


def sms_code(db: Session, pass_id: int) -> str:
    _, secret = _load(db)
    return code_with(secret, pass_id)


def public_key_pem(db: Session) -> str:
    key, _ = _load(db)
    return key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
