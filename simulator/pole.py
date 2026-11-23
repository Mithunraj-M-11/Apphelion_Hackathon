"""What a GB pole sends: gate events and heartbeats, each signed with the pole's own key (HMAC-SHA256 of the exact
body). The GB refuses anything unsigned or wrongly signed. The key is derived from the GB master secret the same way
the backend does it (PoC; real poles keep their key in a secure element)."""

import hashlib
import hmac
import json
import os

import httpx

MASTER = os.environ.get("POLE_MASTER_KEY", "sitewatch-dev-pole-master-key")


def _key(gate: str) -> bytes:
    return hmac.new(MASTER.encode(), f"pole:{gate.upper()}".encode(), hashlib.sha256).digest()


def _post(client: httpx.Client, path: str, gate: str, payload: dict, signed: bool) -> httpx.Response:
    raw = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if signed:
        headers["X-Pole-Signature"] = hmac.new(_key(gate), raw, hashlib.sha256).hexdigest()
    return client.post(path, content=raw, headers=headers)


def event(client: httpx.Client, gate: str, payload: dict, signed: bool = True) -> httpx.Response:
    """A gate event. `signed=False` is someone without the pole's key posing as the pole (a fake event)."""
    return _post(client, f"/api/gates/{gate}/events", gate, payload, signed)


def heartbeat(client: httpx.Client, gate: str, payload: dict) -> httpx.Response:
    return _post(client, f"/api/poles/{gate}/heartbeat", gate, payload, True)
