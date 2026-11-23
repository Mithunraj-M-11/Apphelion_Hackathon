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


def wim_reading(rng, spacings: list[float] | None, empty_t: float, true_weight_t: float | None,
                status: str = "OK") -> dict | None:
    """What the GB's Weigh-in-Motion strip in the lane reports: axle count and spacings from the vehicle's real body,
    axle weights summing to its real weight (not what a rigged weigh pad shows), with in-motion noise (~1.5%).
    None when the vehicle never crossed the strip (it drove round the weigh pad)."""
    if true_weight_t is None:
        return None
    status = (status or "OK").upper()
    if status in ("OFFLINE", "TIMEOUT"):
        return {"status": status}
    spacings = list(spacings or [3.8, 1.35])
    n = len(spacings) + 1
    gross = true_weight_t * (1 + rng.gauss(0, 0.015))
    if status == "POOR":  # braking / bounce over the strip
        gross *= 1 + rng.choice([-1, 1]) * rng.uniform(0.08, 0.15)
    load = max(0.0, true_weight_t - empty_t)
    front_n = 1 if n <= 3 else 2  # steer axle(s): ~42% of the empty truck and ~13% of the load (twin steer: 45% / 30%)
    share_e, share_l = (0.42, 0.13) if front_n == 1 else (0.45, 0.30)
    front = min(gross * 0.6, (share_e * empty_t + share_l * load) * gross / true_weight_t)
    weights = [round(front / front_n, 2)] * front_n + [round((gross - front) / (n - front_n), 2)] * (n - front_n)
    return {"status": status, "axle_count": n,
            "axle_spacings_m": [round(s + rng.gauss(0, 0.03), 2) for s in spacings],
            "axle_weights_t": weights, "speed_kmh": round(rng.uniform(8, 14), 1)}
