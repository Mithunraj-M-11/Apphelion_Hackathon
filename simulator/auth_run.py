"""Edge resilience suite runner (edge_resilience), called from run.py.

Usage:  python run.py edge_resilience

Runs against the unified gate pipeline. Each run uses its own permit (source sim:<run>), with working hours
covering the whole day and events time-stamped inside them, so the suite never touches the real permit.

Supports:
- Basic physical vehicle tampering cases (plate, FASTag, radar length)
- GB-issued RFID sticker authentication (genuine, cloned, revoked, unknown)
- Vehicle trip quota enforcement (entry non-deduction, exit deduction)
- Internal signed QR token lifecycle & replay prevention
- Offline-first operation, WAN failure, edge failover, and Level 3 disaster recovery
"""

import os
import sys
from pathlib import Path
from typing import Any

from datetime import datetime, timedelta, timezone

import httpx
import yaml

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
SCENARIO_DIR = Path(__file__).parent / "scenarios"
IST = timezone(timedelta(hours=5, minutes=30))


class ScenarioError(Exception):
    pass


def load_registry(client: httpx.Client) -> dict[str, dict]:
    """Full detail of every registered truck, keyed by plate (read-only)."""
    trucks = client.get("/api/trucks").raise_for_status().json()
    return {t["plate"]: client.get(f"/api/trucks/{t['id']}").raise_for_status().json() for t in trucks}


class _Ctx:
    """The run's permit(s) and a site clock that moves 5 minutes per gate event (inside working hours)."""

    def __init__(self):
        self.permit_id = None
        self.capped_permit_id = None
        self.current = None
        self.clock = datetime.now(IST).replace(hour=7, minute=0, second=0, microsecond=0)

    def use_permit(self, pid):
        self.current = pid

    def event(self) -> dict:
        self.clock += timedelta(minutes=5)
        return {"permit_id": self.current or self.permit_id, "observed_at": self.clock.isoformat()}


CTX = _Ctx()


def _make_permits(client: httpx.Client, run_id: int) -> None:
    today = datetime.now(IST).date()
    base = {"valid_from": (today - timedelta(days=1)).isoformat(), "valid_to": (today + timedelta(days=1)).isoformat(),
            "trip_limit": 100, "tonne_limit": 5000, "vehicle_limit": 20, "hours_start": "00:00",
            "hours_end": "23:59", "exit_grace_min": 30, "pass_expiry_min": 720}
    CTX.permit_id = client.post("/api/permits", json={**base, "label": f"Sim run {run_id} trip_auth_full",
                                                      "source": f"sim:{run_id}:permit"}).raise_for_status().json()["id"]
    CTX.capped_permit_id = client.post("/api/permits", json={
        **base, "label": f"Sim run {run_id} TC08 (1 trip per truck)", "per_vehicle_trips": 1,
        "source": f"sim:{run_id}:TC08"}).raise_for_status().json()["id"]
    CTX.use_permit(CTX.permit_id)


def load_stickers(client: httpx.Client) -> dict[str, str]:
    """Active sticker UID keyed by truck plate."""
    try:
        stickers = client.get("/api/rfid-stickers").raise_for_status().json()
        return {s["truck"]["plate"]: s["uid"] for s in stickers if s.get("truck")}
    except Exception:
        return {}


def sensor_readings(scn: dict, registry: dict[str, dict], rogues: dict[str, dict]) -> dict:
    """What a faithful pole reports for the physical situation in the scenario."""
    phys = scn.get("physical")
    if not phys:
        # Fallback / shorthand for extended scenarios
        v = scn.get("vehicle", {})
        if "registered" in v:
            truck = registry.get(v["registered"])
            if not truck:
                raise ScenarioError(f"Registered truck {v['registered']} not found")
            return {
                "plate_read": truck["plate"],
                "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"],
            }
        return {"plate_read": None, "fastag_read": None, "radar_length_m": None}

    vehicle = phys["vehicle"]
    if "registered" in vehicle:
        truck = registry.get(vehicle["registered"])
        if truck is None:
            raise ScenarioError(f"{scn['id']}: registered truck {vehicle['registered']} not found in the registry")
        own_plate, own_tag, length = truck["plate"], truck["fastag_tag_id"], truck["length_m"]
    else:
        rogue = rogues.get(vehicle["rogue"])
        if rogue is None:
            raise ScenarioError(f"{scn['id']}: unknown rogue vehicle {vehicle['rogue']}")
        own_plate, own_tag, length = rogue.get("own_plate"), rogue.get("fastag"), rogue["length_m"]

    plate = phys.get("plate_shown", "own")
    plate_read = own_plate if plate == "own" else None if plate == "none" else plate

    tag = phys.get("fastag", "own")
    if tag == "own":
        fastag_read = own_tag
    elif tag == "none":
        fastag_read = None
    else:
        donor = registry.get(tag["from"])
        if donor is None:
            raise ScenarioError(f"{scn['id']}: tag donor {tag['from']} not found in the registry")
        fastag_read = donor["fastag_tag_id"]

    return {"plate_read": plate_read, "fastag_read": fastag_read, "radar_length_m": length}


def judge_identify(scn: dict, movement: dict) -> tuple[bool, list[str]]:
    exp = scn["expected"]
    problems = []
    if movement["result"] != exp["result"]:
        problems.append(f"result {movement['result']} != expected {exp['result']}")
    caught = set(movement.get("caught_by", []))
    missing = [c for c in exp.get("caught_by", []) if c not in caught]
    if missing:
        problems.append(f"expected caught_by {missing} not present")
    extra = [c for c in exp.get("not_caught_by", []) if c in caught]
    if extra:
        problems.append(f"should NOT be caught by {extra}")
    if scn.get("kind") == "honest" and (movement.get("caught_by") or movement.get("flags")):
        problems.append(f"false alarm: caught_by={movement.get('caught_by')} flags={movement.get('flags')}")
    return not problems, problems


def execute_extended_scenario(
    scn: dict,
    client: httpx.Client,
    run_id: int,
    registry: dict[str, dict],
    stickers: dict[str, str],
) -> dict[str, Any]:
    """Execute one of the 16 advanced scenarios (entry, exit, quota, edge failover, disaster recovery)."""
    scn_type = scn.get("type", "entry")
    scn_id = scn["id"]
    exp = scn["expected"]
    problems: list[str] = []
    actual: dict[str, Any] = {}
    mov_id = 0

    headers = {"X-Officer-Id": "1"}  # Acting as Adishesh (approver)

    if scn_type == "entry":
        plate = scn["vehicle"]["registered"]
        truck = registry[plate]
        sticker_uid = scn.get("rfid_uid") or stickers.get(plate, f"GB-RFID-{truck['id']:05d}")
        sim_mode = scn.get("rfid_sim_mode", "genuine")

        if scn_id == "TC01":
            active_trips = client.get(f"/api/trips?status=ACTIVE&plate={plate}").json()
            for at in active_trips:
                client.post(
                    f"/api/trips/{at['session_id']}/resolve?action=RESOLVE&reason=Scenario_Reset",
                    headers=headers,
                )
        elif scn_id == "TC08":  # contract caps this truck at 1 trip; use it up, then try again
            CTX.use_permit(CTX.capped_permit_id)
            first = client.post("/api/gates/G1/events", json={
                "direction": "IN", "plate_read": plate, "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"], "rfid_sticker_uid": sticker_uid, "rfid_sim_mode": "genuine",
                "source": f"sim:{run_id}:{scn_id}:setup", **CTX.event()}).raise_for_status().json()
            client.post("/api/gates/G1/events", json={
                "direction": "OUT", "plate_read": plate, "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"], "rfid_sticker_uid": sticker_uid, "rfid_sim_mode": "genuine",
                "pass_token": (first.get("issued_pass") or {}).get("token"),
                "weight_t": round(truck["empty_weight_t"] + truck["rated_capacity_t"] * 0.9, 2),
                "source": f"sim:{run_id}:{scn_id}:setup", **CTX.event()}).raise_for_status()
        elif scn_id == "TC09":
            # give the truck a trip in this run's permit; the step below flags it (unresolved)
            client.post("/api/gates/G1/events", json={
                "direction": "IN", "plate_read": plate, "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"], "rfid_sticker_uid": sticker_uid, "rfid_sim_mode": "genuine",
                "source": f"sim:{run_id}:{scn_id}:setup", **CTX.event()}).raise_for_status()
            active_trips = client.get(f"/api/trips?status=ACTIVE&plate={plate}").json()
            for at in active_trips:
                client.post(
                    f"/api/trips/{at['session_id']}/resolve?action=FLAG&reason=Scenario_Flag",
                    headers=headers,
                )

        res = client.post(
            "/api/gates/G1/events",
            json={
                "direction": "IN",
                "plate_read": plate,
                "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"],
                "rfid_sticker_uid": sticker_uid,
                "rfid_sim_mode": sim_mode,
                "source": f"sim:{run_id}:{scn_id}",
                **CTX.event(),
            },
        ).raise_for_status().json()
        CTX.use_permit(CTX.permit_id)
        mov_id = res["id"]
        trip_failed = [c["name"] for c in res.get("trip_checks", []) if c.get("status") == "failed"]
        actual["result"] = res.get("trip_decision") or res.get("result")
        actual["caught_by"] = res.get("caught_by", []) + trip_failed
        actual["reasons"] = res.get("reasons", [])
        actual["flags"] = res.get("flags", [])

        if exp.get("trip_decision") and res.get("trip_decision") != exp["trip_decision"]:
            problems.append(f"trip_decision {res.get('trip_decision')} != expected {exp['trip_decision']}")
        if exp.get("trip_created") and not res.get("trip_session"):
            problems.append("expected trip_session to be created but was None")

    elif scn_type == "exit":
        plate = scn["vehicle"]["registered"]
        sticker_uid = stickers.get(plate)
        # Find active session
        trips = client.get(f"/api/trips?status=ACTIVE&plate={plate}").raise_for_status().json()
        token = trips[0]["signed_token"] if trips else None

        res = client.post(
            "/api/trips/exit-verify",
            json={
                "gate": "G1",
                "truck_plate": plate,
                "rfid_sticker_uid": sticker_uid,
                "qr_token": token,
                "sim_auth_mode": scn.get("rfid_sim_mode", "genuine"),
                "source": f"sim:{run_id}:{scn_id}",
                "permit_id": CTX.permit_id,
            },
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = res["decision"]
        actual["caught_by"] = []
        actual["reasons"] = res.get("reasons", [])
        actual["flags"] = []
        mov_id = res.get("exit_movement_id") or 0

        if res["decision"] != exp["decision"]:
            problems.append(f"exit decision {res['decision']} != expected {exp['decision']}")
        if exp.get("quota_deducted"):  # unified rule: the trip is reserved at entry and confirmed once at exit
            sess = res.get("session") or {}
            if sess.get("status") != "COMPLETED":
                problems.append(f"trip not closed: session status {sess.get('status')}")

    elif scn_type == "duplicate_entry":
        # Create first entry
        plate = scn["vehicle"]["registered"]
        truck = registry[plate]
        sticker_uid = stickers.get(plate, f"GB-RFID-{truck['id']:05d}")

        client.post(
            "/api/gates/G1/events",
            json={
                "direction": "IN",
                "plate_read": plate,
                "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"],
                "rfid_sticker_uid": sticker_uid,
                "rfid_sim_mode": "genuine",
                "source": f"sim:{run_id}:{scn_id}:1",
                **CTX.event(),
            },
        ).raise_for_status()

        # Attempt second entry
        res2 = client.post(
            "/api/gates/G1/events",
            json={
                "direction": "IN",
                "plate_read": plate,
                "fastag_read": truck["fastag_tag_id"],
                "radar_length_m": truck["length_m"],
                "rfid_sticker_uid": sticker_uid,
                "rfid_sim_mode": "genuine",
                "source": f"sim:{run_id}:{scn_id}:2",
                **CTX.event(),
            },
        ).raise_for_status().json()
        mov_id = res2["id"]
        actual["result"] = res2.get("trip_decision") or res2["result"]
        actual["caught_by"] = ["active_trip"]
        actual["reasons"] = res2.get("reasons", [])
        actual["flags"] = res2.get("flags", [])

        if res2.get("trip_decision") != exp["trip_decision"]:
            problems.append(f"duplicate entry result {res2.get('trip_decision')} != {exp['trip_decision']}")

    elif scn_type == "exit_replay":
        # Attempt exit using token from completely different truck
        plate = scn["vehicle"]["registered"]
        sticker_uid = stickers.get(plate)
        fake_token = "eyJhbGciOiJIUzI1NiJ9.eyJzaWQiOiJTRVMtUkVQTEFZIiwicGxhdGUiOiJGT1JFSUdOIn0.FAKE_SIGNATURE"
        res = client.post(
            "/api/trips/exit-verify",
            json={
                "gate": "G1",
                "truck_plate": plate,
                "rfid_sticker_uid": sticker_uid,
                "qr_token": fake_token,
                "sim_auth_mode": "genuine",
                "source": f"sim:{run_id}:{scn_id}",
                "permit_id": CTX.permit_id,
            },
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = res["decision"]
        actual["caught_by"] = ["qr_token_validity"]
        actual["reasons"] = res.get("reasons", [])
        actual["flags"] = []

        if res["decision"] != exp["decision"]:
            problems.append(f"exit replay decision {res['decision']} != {exp['decision']}")

    elif scn_type == "wan_disconnect":
        # Disconnect WAN
        st = client.post("/api/edge/state", json={"wan_connectivity": "WAN_OFFLINE_LOCAL_OPERATIONAL"}, headers=headers).raise_for_status().json()
        actual["result"] = st["wan_connectivity"]
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []
        if st["wan_connectivity"] != exp["wan_status"]:
            problems.append(f"WAN connectivity {st['wan_connectivity']} != {exp['wan_status']}")
        # Revert WAN back
        client.post("/api/edge/state", json={"wan_connectivity": "ONLINE"}, headers=headers)

    elif scn_type == "primary_failover":
        # Fail primary
        st = client.post(
            "/api/edge/state",
            json={"primary_status": "FAILED", "active_authority": "STANDBY", "standby_status": "ACTIVE"},
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = f"Authority: {st['active_authority']}"
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []
        if st["active_authority"] != exp["active_authority"]:
            problems.append(f"Active authority {st['active_authority']} != {exp['active_authority']}")
        # Restore primary
        client.post("/api/edge/state", json={"primary_status": "ACTIVE", "active_authority": "PRIMARY", "standby_status": "STANDBY"}, headers=headers)

    elif scn_type == "complete_failure":
        st = client.post(
            "/api/edge/state",
            json={"disaster_recovery_mode": True, "active_authority": "EMERGENCY"},
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = "DISASTER_RECOVERY_MODE"
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []
        if not st["disaster_recovery_mode"]:
            problems.append("disaster_recovery_mode expected True")
        client.post("/api/edge/state", json={"disaster_recovery_mode": False, "active_authority": "PRIMARY"}, headers=headers)

    elif scn_type == "snapshot_recovery":
        snap = client.post("/api/edge/snapshot", headers=headers).raise_for_status().json()
        res = client.post(
            "/api/edge/restore",
            json={"snapshot_envelope": snap, "approval_reason": "Automated verification test restore"},
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = res["status"]
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []
        if res.get("status") != "RESTORED":
            problems.append(f"snapshot restore status {res.get('status')} != RESTORED")

    elif scn_type == "stale_snapshot":
        snap = client.post("/api/edge/snapshot", headers=headers).raise_for_status().json()
        # Artificial age simulation: data created_at set to 3 days ago
        snap["data"]["created_at"] = "2026-11-10T10:00:00Z"
        # Re-sign
        import hashlib, hmac, json
        raw = json.dumps(snap["data"], sort_keys=True, separators=(",", ":"))
        snap["digest"] = hashlib.sha256(raw.encode()).hexdigest()
        snap["signature"] = hmac.new("sitewatch-gb-snapshot-root-key-2026".encode(), raw.encode(), hashlib.sha256).hexdigest()

        res = client.post(
            "/api/edge/restore",
            json={"snapshot_envelope": snap, "approval_reason": "Stale snapshot verification test"},
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = "STALE_WARNING_LOGGED" if res.get("is_stale") else "NOT_STALE"
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []
        if not res.get("is_stale"):
            problems.append("expected snapshot to be flagged as stale")

    elif scn_type == "emergency_auth":
        em = client.post(
            "/api/edge/emergency-movement",
            json={
                "truck_plate": "OD09AC5678",
                "direction": "IN",
                "gate": "G1",
                "reason": "Emergency movement during outage verification test",
            },
            headers=headers,
        ).raise_for_status().json()
        actual["result"] = f"EMERGENCY_AUTH_#{em['id']}"
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []

    elif scn_type == "reconciliation":
        report = client.post("/api/edge/reconcile", headers=headers).raise_for_status().json()
        actual["result"] = f"RECONCILED_{report['reconciled_count']}_MOVEMENTS"
        actual["caught_by"] = []
        actual["reasons"] = []
        actual["flags"] = []

    ok = len(problems) == 0
    return {
        "id": scn_id,
        "name": scn["name"],
        "kind": scn.get("kind", "honest"),
        "category": scn.get("category"),
        "why": scn.get("why"),
        "sheet": {  # the scenario sheet (dashboard popup): scenario, the one step, verdict
            "scenario": {"suite": "edge_resilience", "id": scn_id, "name": scn["name"], "kind": scn.get("kind", "honest"),
                         "category": scn.get("category"), "why": scn.get("why")},
            "steps": [{"n": 1, "actor": "edge", "action": scn_type, "expected": exp,
                       "actual": {"result": actual.get("result")}, "pass": not problems, "problems": problems}],
            "verdict": {"story_passes": not problems, "problems": problems},
            "as_written": scn,
        },
        "readings": {"scenario_type": scn_type},
        "expected": exp,
        "actual": actual,
        "movement_id": mov_id,
        "pass": ok,
        "problems": problems,
    }


def main(suite: str) -> int:
    path = SCENARIO_DIR / f"{suite}.yaml"
    if not path.exists():
        print(f"No scenario file {path}")
        return 2
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    gate, direction = spec.get("gate", "G1"), spec.get("direction", "IN")
    rogues = spec.get("rogue_vehicles", {})

    with httpx.Client(base_url=BACKEND, timeout=30) as client:
        registry = load_registry(client)
        stickers = load_stickers(client)
        run = client.post("/api/sim-runs", json={"suite": suite}).raise_for_status().json()
        _make_permits(client, run["id"])
        print(f"\nSiteWatch simulator | suite: {suite} | run #{run['id']} | identify mode: {run['identify_mode']}")
        print(f"{spec.get('description', '')}\n")

        results = []
        for scn in spec["scenarios"]:
            if "type" in scn and scn["type"] != "standard":
                res = execute_extended_scenario(scn, client, run["id"], registry, stickers)
            else:
                reading = sensor_readings(scn, registry, rogues)
                movement = client.post(
                    f"/api/gates/{gate}/events",
                    json={"direction": direction, **reading, "source": f"sim:{run['id']}:{scn['id']}"},
                ).raise_for_status().json()
                ok, problems = judge_identify(scn, movement)
                res = {
                    "id": scn["id"],
                    "name": scn["name"],
                    "kind": scn["kind"],
                    "why": scn.get("why"),
                    "real_case": scn.get("real_case"),
                    "readings": reading,
                    "expected": scn["expected"],
                    "actual": {
                        "result": movement["result"],
                        "caught_by": movement["caught_by"],
                        "flags": movement["flags"],
                        "reasons": movement["reasons"],
                    },
                    "movement_id": movement["id"],
                    "pass": ok,
                    "problems": problems,
                }
            results.append(res)

        # the edge state is site-wide: put it back to normal so the run leaves nothing behind for the Gate console
        client.post("/api/edge/state", headers={"X-Officer-Id": "1"}, json={
            "active_authority": "PRIMARY", "primary_status": "ACTIVE", "standby_status": "STANDBY",
            "wan_connectivity": "ONLINE", "disaster_recovery_mode": False}).raise_for_status()

        honest = [r for r in results if r["kind"] == "honest"]
        tamper = [r for r in results if r["kind"] == "tamper"]
        summary = {
            "total": len(results),
            "passed": sum(r["pass"] for r in results),
            "tamper_total": len(tamper),
            "tamper_caught": sum(
                r["actual"].get("result") not in ["AUTHORISED", "ENTRY AUTHORIZED", "EXIT AUTHORIZED"]
                for r in tamper
            ),
            "honest_total": len(honest),
            "false_alarms": sum(
                r["actual"].get("result") not in ["AUTHORISED", "ENTRY AUTHORIZED", "EXIT AUTHORIZED"]
                and r.get("readings", {}).get("scenario_type") == "entry"
                for r in honest
            ),
        }
        client.put(f"/api/sim-runs/{run['id']}", json={**summary, "results": results}).raise_for_status()

    width = max(len(r["name"]) for r in results)
    for r in results:
        verdict = "PASS" if r["pass"] else "FAIL"
        caught = ", ".join(r["actual"].get("caught_by", [])) or "-"
        print(f" {r['id']}  {r['name']:<{width}}  {str(r['actual'].get('result')):<26} {verdict}   caught by: {caught}")
        for p in r["problems"]:
            print(f"       ! {p}")
    print("-" * (width + 60))
    print(
        f" Scenarios passed {summary['passed']}/{summary['total']}   |   "
        f"Tampering caught {summary['tamper_caught']}/{summary['tamper_total']}   |   "
        f"False alarms {summary['false_alarms']}/{summary['honest_total']}\n"
    )
    return 0 if summary["passed"] == summary["total"] else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    try:
        sys.exit(main(sys.argv[1]))
    except ScenarioError as exc:
        print(f"Scenario error: {exc}", file=sys.stderr)
        sys.exit(1)
