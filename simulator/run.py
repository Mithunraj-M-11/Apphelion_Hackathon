"""SiteWatch scenario simulator: plays the role of a gate pole.

Usage:  python run.py <suite>          (e.g. identify_basic -> scenarios/identify_basic.yaml)

For each scenario it builds the sensor readings that a faithful pole would report for the physical situation,
posts them to the GB backend exactly like a real pole, and compares the decision with the expected one.
It never writes to the registry: the registry is ground truth.
"""

import os
import sys
from pathlib import Path

import httpx
import yaml

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
SCENARIO_DIR = Path(__file__).parent / "scenarios"


class ScenarioError(Exception):
    pass


def load_registry(client: httpx.Client) -> dict[str, dict]:
    """Full detail of every registered truck, keyed by plate (read-only)."""
    trucks = client.get("/api/trucks").raise_for_status().json()
    return {t["plate"]: client.get(f"/api/trucks/{t['id']}").raise_for_status().json() for t in trucks}


def sensor_readings(scn: dict, registry: dict[str, dict], rogues: dict[str, dict]) -> dict:
    """What a faithful pole reports for the physical situation in the scenario."""
    phys = scn["physical"]
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
    else:  # {from: <registered plate>} -> tag physically taken from another registered truck
        donor = registry.get(tag["from"])
        if donor is None:
            raise ScenarioError(f"{scn['id']}: tag donor {tag['from']} not found in the registry")
        fastag_read = donor["fastag_tag_id"]

    return {"plate_read": plate_read, "fastag_read": fastag_read, "radar_length_m": length}


def judge(scn: dict, movement: dict) -> tuple[bool, list[str]]:
    exp = scn["expected"]
    problems = []
    if movement["result"] != exp["result"]:
        problems.append(f"result {movement['result']} != expected {exp['result']}")
    caught = set(movement["caught_by"])
    missing = [c for c in exp.get("caught_by", []) if c not in caught]
    if missing:
        problems.append(f"expected caught_by {missing} not present")
    extra = [c for c in exp.get("not_caught_by", []) if c in caught]
    if extra:
        problems.append(f"should NOT be caught by {extra}")
    if scn["kind"] == "honest" and (movement["caught_by"] or movement["flags"]):
        problems.append(f"false alarm: caught_by={movement['caught_by']} flags={movement['flags']}")
    return not problems, problems


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
        run = client.post("/api/sim-runs", json={"suite": suite}).raise_for_status().json()
        print(f"\nSiteWatch simulator | suite: {suite} | run #{run['id']} | identify mode: {run['identify_mode']}")
        print(f"{spec.get('description', '')}\n")

        results = []
        for scn in spec["scenarios"]:
            reading = sensor_readings(scn, registry, rogues)
            movement = client.post(
                f"/api/gates/{gate}/events",
                json={"direction": direction, **reading, "source": f"sim:{run['id']}:{scn['id']}"},
            ).raise_for_status().json()
            ok, problems = judge(scn, movement)
            results.append({
                "id": scn["id"],
                "name": scn["name"],
                "kind": scn["kind"],
                "why": scn.get("why"),
                "real_case": scn.get("real_case"),
                "readings": reading,
                "expected": scn["expected"],
                "actual": {"result": movement["result"], "caught_by": movement["caught_by"],
                           "flags": movement["flags"], "reasons": movement["reasons"]},
                "movement_id": movement["id"],
                "pass": ok,
                "problems": problems,
            })

        honest = [r for r in results if r["kind"] == "honest"]
        tamper = [r for r in results if r["kind"] == "tamper"]
        summary = {
            "total": len(results),
            "passed": sum(r["pass"] for r in results),
            "tamper_total": len(tamper),
            "tamper_caught": sum(r["actual"]["result"] != "AUTHORISED" for r in tamper),
            "honest_total": len(honest),
            "false_alarms": sum(r["actual"]["result"] != "AUTHORISED" or bool(r["actual"]["flags"]) for r in honest),
        }
        client.put(f"/api/sim-runs/{run['id']}", json={**summary, "results": results}).raise_for_status()

    width = max(len(r["name"]) for r in results)
    for r in results:
        verdict = "PASS" if r["pass"] else "FAIL"
        caught = ", ".join(r["actual"]["caught_by"]) or "-"
        print(f" {r['id']}  {r['name']:<{width}}  {r['actual']['result']:<15} {verdict}   caught by: {caught}")
        for p in r["problems"]:
            print(f"       ! {p}")
    print("-" * (width + 60))
    print(f" Scenarios passed {summary['passed']}/{summary['total']}   |   "
          f"Tampering caught {summary['tamper_caught']}/{summary['tamper_total']}   |   "
          f"False alarms {summary['false_alarms']}/{summary['honest_total']}\n")
    return 0 if summary["passed"] == summary["total"] else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    try:
        sys.exit(main(sys.argv[1]))
    except ScenarioError as exc:
        print(f"Scenario error: {exc}")
        sys.exit(2)
