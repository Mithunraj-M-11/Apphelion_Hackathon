"""Pass signing: only the GB key makes a valid pass; any edit breaks it (no database needed)."""

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.passes import _b64, _unb64, code_with, sign_with, verify_with

KEY = Ed25519PrivateKey.generate()
PAYLOAD = {"pass": "P-0001", "plate": "OD09AB1234", "expires_at": "2026-11-21T10:00:00+05:30"}


def test_valid_pass_verifies_and_returns_payload():
    assert verify_with(KEY.public_key(), sign_with(KEY, PAYLOAD)) == PAYLOAD


def test_edited_payload_fails():
    body, sig = sign_with(KEY, PAYLOAD).split(".")
    edited = _b64(_unb64(body).replace(b"OD09AB1234", b"OD09AC5678"))
    assert verify_with(KEY.public_key(), f"{edited}.{sig}") is None


def test_pass_signed_by_another_key_fails():
    other = Ed25519PrivateKey.generate()
    assert verify_with(KEY.public_key(), sign_with(other, PAYLOAD)) is None


def test_garbage_fails():
    for token in ("", "abc", "a.b.c", "not-base64!.###"):
        assert verify_with(KEY.public_key(), token) is None


def test_sms_code_is_8_chars_stable_and_secret_dependent():
    a = code_with(b"secret-1", 17)
    assert len(a) == 8 and a == code_with(b"secret-1", 17)
    assert a != code_with(b"secret-2", 17) and a != code_with(b"secret-1", 18)
