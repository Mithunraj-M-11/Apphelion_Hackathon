"""SiteWatch scenario simulator: plays the role of the gate poles.

Usage:  python run.py <suite>        e.g. identify_basic -> scenarios/identify_basic.yaml
                                          trip_basic     -> scenarios/trip_basic.yaml
        python run.py site <scenario>  a whole contract period -> scenarios/site/<scenario>.yaml (see site_run.py)
        python run.py trip_auth_full   GB RFID sticker / trip-session / edge-recovery suite (see auth_run.py)

Two scenario formats:
- single (identify_basic): one gate reading per scenario, judged on the Identify result.
- trip   (trip_basic):     a short story of timed gate events (entry, exit, ...) under a small permit, judged on
                           every event (barrier, pass, trip, alerts).

Each scenario gets its OWN permit (source-tagged), so passes, quotas and holds never leak between scenarios.
For each event the simulator builds what a faithful pole would report for the physical situation (plate on the
truck, tag on the windscreen, real length, real weight, what the driver shows at exit, barrier impact) and posts
it to the GB backend exactly like a real pole. It never writes to the registry: the registry is ground truth.
"""

import os
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
SCENARIO_DIR = Path(__file__).parent / "scenarios"
IST = timezone(timedelta(hours=5, minutes=30))
SERIOUS = ("HIGH", "CRITICAL")

DEFAULT_PERMIT = {"trip_limit": 50, "tonne_limit": 1500, "vehicle_limit": 20, "hours_start": "06:00",
                  "hours_end": "18:00", "exit_grace_min": 30, "pass_expiry_min": 120}


class ScenarioError(Exception):
    pass


STICKERS: dict[str, str] = {}  # GB RFID sticker UID by plate, loaded per run


def load_registry(client: httpx.Client) -> dict[str, dict]:
    """Full detail of every registered truck, keyed by plate (read-only)."""
    trucks = client.get("/api/trucks").raise_for_status().json()
    return {t["plate"]: client.get(f"/api/trucks/{t['id']}").raise_for_status().json() for t in trucks}


def load_stickers(client: httpx.Client) -> dict[str, str]:
    """GB RFID sticker UID keyed by truck plate (read-only)."""
    stickers = client.get("/api/rfid-stickers").raise_for_status().json()
    return {s["truck"]["plate"]: s["uid"] for s in stickers if s.get("truck") and s.get("status") != "REPLACED"}


def sticker_reading(ev: dict, vehicle: dict, stickers: dict[str, str], sid: str) -> dict:
    """What the GB RFID reader reports: the vehicle's own sticker (registered trucks), none, or one taken from
    another truck; `rfid` = genuine | cloned | revoked | unknown_damaged (what the challenge-response shows)."""
    spec = ev.get("sticker", "own")
    if spec == "none":
        uid = None
    elif spec == "own":
        uid = stickers.get(vehicle["plate"]) if vehicle.get("registered") else None
    else:
        uid = stickers.get(spec["from"])
        if uid is None:
            raise ScenarioError(f"{sid}: no GB sticker for {spec['from']}")
    return {"rfid_sticker_uid": uid, "rfid_sim_mode": ev.get("rfid", "genuine")}


def create_permit(client: httpx.Client, label: str, source: str, overrides: dict | None) -> dict:
    today = datetime.now(IST).date()
    body = {**DEFAULT_PERMIT, **(overrides or {}), "label": label, "source": source,
            "valid_from": (today - timedelta(days=30)).isoformat(), "valid_to": (today + timedelta(days=30)).isoformat()}
    return client.post("/api/permits", json=body).raise_for_status().json()


def vehicle_of(spec, sid: str, registry: dict[str, dict], rogues: dict[str, dict]) -> dict:
    """The physical vehicle: own plate, own tag, real length, empty weight, rated capacity."""
    if isinstance(spec, str):
        spec = {"registered": spec}
    if "registered" in spec:
        t = registry.get(spec["registered"])
        if t is None:
            raise ScenarioError(f"{sid}: registered truck {spec['registered']} not found in the registry")
        return {"label": t["plate"], "plate": t["plate"], "tag": t["fastag_tag_id"], "length": t["length_m"],
                "empty": t["empty_weight_t"], "rated": t["rated_capacity_t"], "registered": True}
    r = rogues.get(spec["rogue"])
    if r is None:
        raise ScenarioError(f"{sid}: unknown rogue vehicle {spec['rogue']}")
    return {"label": spec["rogue"], "plate": r.get("own_plate"), "tag": r.get("fastag"), "length": r["length_m"],
            "empty": r.get("empty_weight_t", 12.0), "rated": r.get("rated_capacity_t", 25.0)}


def identity_readings(phys: dict, sid: str, vehicle: dict, registry: dict[str, dict]) -> dict:
    plate = phys.get("plate_shown", "own")
    plate_read = vehicle["plate"] if plate == "own" else None if plate == "none" else plate
    tag = phys.get("fastag", "own")
    if tag == "own":
        fastag_read = vehicle["tag"]
    elif tag == "none":
        fastag_read = None
    else:  # {from: <registered plate>}: tag physically taken from (or cloned from) another registered truck
        donor = registry.get(tag["from"])
        if donor is None:
            raise ScenarioError(f"{sid}: tag donor {tag['from']} not found in the registry")
        fastag_read = donor["fastag_tag_id"]
    return {"plate_read": plate_read, "fastag_read": fastag_read, "radar_length_m": vehicle["length"]}


# ================================================================ single-event format (identify_basic)
def judge_single(scn: dict, movement: dict) -> tuple[bool, list[str]]:
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


def run_single(client, spec, run, registry) -> tuple[list[dict], dict]:
    gate, direction = spec.get("gate", "G1"), spec.get("direction", "IN")
    rogues = spec.get("rogue_vehicles", {})
    results = []
    for scn in spec["scenarios"]:
        source = f"sim:{run['id']}:{scn['id']}"
        permit = create_permit(client, f"Sim run {run['id']} {scn['id']}", source, spec.get("permit"))
        vehicle = vehicle_of(scn["physical"]["vehicle"], scn["id"], registry, rogues)
        reading = identity_readings(scn["physical"], scn["id"], vehicle, registry)
        movement = client.post(f"/api/gates/{gate}/events", json={
            "direction": direction, **reading, **sticker_reading(scn["physical"], vehicle, STICKERS, scn["id"]),
            "source": source, "permit_id": permit["id"],
            "weight_t": round(vehicle["empty"], 2),
        }).raise_for_status().json()
        ok, problems = judge_single(scn, movement)
        results.append({
            "id": scn["id"], "name": scn["name"], "kind": scn["kind"], "why": scn.get("why"),
            "real_case": scn.get("real_case"), "readings": reading, "expected": scn["expected"],
            "actual": {"result": movement["result"], "caught_by": movement["caught_by"],
                       "flags": movement["flags"], "reasons": movement["reasons"]},
            "movement_id": movement["id"], "permit_id": permit["id"], "pass": ok, "problems": problems,
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
    return results, summary


# ================================================================ trip format (trip_basic)
def weight_of(load, vehicle: dict) -> float | None:
    """`load` = what is physically in the body: tonnes, 'NN%' of rated capacity, or 'none' (no pad reading)."""
    if load == "none":
        return None
    if isinstance(load, str) and load.endswith("%"):
        load_t = vehicle["rated"] * float(load[:-1]) / 100
    else:
        load_t = float(load)
    return round(vehicle["empty"] + load_t, 2)


def shown_at_exit(ev: dict, sid: str, vkey: str, own_pass: dict, issued: dict) -> tuple[dict, str]:
    """What the driver presents at the exit barrier: own QR / SMS code, nothing, or another pass."""
    shown = ev.get("pass", "qr")

    def from_event(n: int) -> dict:
        p = issued.get(n)
        if p is None:
            raise ScenarioError(f"{sid}: event {n} did not issue a pass")
        return p

    if shown == "none":
        return {}, "nothing"
    if shown in ("qr", "sms"):
        p = own_pass.get(vkey)
        if p is None:
            return {}, "nothing (no pass)"
        return ({"pass_token": p["token"]}, f"own QR {p['code']}") if shown == "qr" else \
            ({"pass_code": p["sms_code"]}, f"own SMS code {p['sms_code']}")
    if "qr_from" in shown:
        p = from_event(shown["qr_from"])
        return {"pass_token": p["token"]}, f"QR of {p['code']} (event {shown['qr_from']})"
    if "sms_from" in shown:
        p = from_event(shown["sms_from"])
        return {"pass_code": p["sms_code"]}, f"SMS code of {p['code']} (event {shown['sms_from']})"
    if "tampered_qr_from" in shown:
        p = from_event(shown["tampered_qr_from"])
        body, sig = p["token"].split(".")
        i = len(body) // 2  # flip one character in the signed payload (e.g. an edited plate or expiry)
        body = body[:i] + ("A" if body[i] != "A" else "B") + body[i + 1:]
        return {"pass_token": f"{body}.{sig}"}, f"edited copy of the QR of {p['code']}"
    raise ScenarioError(f"{sid}: unknown pass option {shown}")


def judge_event(exp: dict, mv: dict) -> list[str]:
    problems = []
    codes = [a["code"] for a in mv["alerts"]]
    if "barrier" in exp and mv["barrier"] != exp["barrier"]:
        problems.append(f"barrier {mv['barrier']} != expected {exp['barrier']}")
    if "pass_issued" in exp and bool(mv.get("issued_pass")) != exp["pass_issued"]:
        problems.append(f"pass issued {bool(mv.get('issued_pass'))} != expected {exp['pass_issued']}")
    if "trip" in exp and mv["trip"] != exp["trip"]:
        problems.append(f"trip {mv['trip']} != expected {exp['trip']}")
    if "result" in exp and mv["result"] != exp["result"]:
        problems.append(f"identify {mv['result']} != expected {exp['result']}")
    missing = [c for c in exp.get("alerts", []) if c not in codes]
    if missing:
        problems.append(f"expected alerts {missing} not raised")
    extra = [c for c in exp.get("not_alerts", []) if c in codes]
    if extra:
        problems.append(f"should NOT raise {extra}")
    return problems


def run_trip(client, spec, run, registry) -> tuple[list[dict], dict]:
    gate = spec.get("gate", "G1")
    rogues = spec.get("rogue_vehicles", {})
    today = datetime.now(IST).date()
    results = []
    for scn in spec["scenarios"]:
        sid = scn["id"]
        source = f"sim:{run['id']}:{sid}"
        permit = create_permit(client, f"Sim run {run['id']} {sid}", source,
                               {**spec.get("permit", {}), **scn.get("permit", {})})
        own_pass: dict[str, dict] = {}  # vehicle label -> its latest pass (what is on the driver's phone)
        issued: dict[int, dict] = {}  # event number -> pass issued at that event
        events, all_alerts, problems = [], [], []
        for n, ev in enumerate(scn["events"], start=1):
            vehicle = vehicle_of(ev["vehicle"], sid, registry, rogues)
            vkey = vehicle["label"]
            reading = identity_readings(ev, sid, vehicle, registry)
            hh, mm = map(int, ev["at"].split(":"))
            observed = datetime.combine(today, time(hh, mm), tzinfo=IST)
            load = ev.get("load", 0 if ev["dir"] == "IN" else "90%")
            body = {"direction": ev["dir"], **reading, **sticker_reading(ev, vehicle, STICKERS, sid),
                    "weight_t": weight_of(load, vehicle),
                    "observed_at": observed.isoformat(), "barrier_forced": bool(ev.get("forces")),
                    "permit_id": permit["id"], "source": source}
            shown = None
            if ev["dir"] == "OUT":
                extra, shown = shown_at_exit(ev, sid, vkey, own_pass, issued)
                body.update(extra)
            mv = client.post(f"/api/gates/{gate}/events", json=body).raise_for_status().json()
            if mv.get("issued_pass"):
                own_pass[vkey] = issued[n] = mv["issued_pass"]
            exp = ev.get("expect", {})
            ev_problems = judge_event(exp, mv)
            problems += [f"event {n}: {p}" for p in ev_problems]
            alerts = [{"code": a["code"], "severity": a["severity"], "message": a["message"]} for a in mv["alerts"]]
            all_alerts += alerts
            events.append({
                "n": n, "at": ev["at"], "dir": ev["dir"], "vehicle": vkey, "note": ev.get("note"),
                "readings": {**reading, "weight_t": body["weight_t"], "shown": shown,
                             "forced": bool(ev.get("forces"))},
                "expected": exp,
                "actual": {"result": mv["result"], "decision": mv["decision"], "barrier": mv["barrier"],
                           "trip": mv["trip"], "pass_issued": (mv.get("issued_pass") or {}).get("code"),
                           "pass": (mv.get("pass") or {}).get("code"), "alerts": alerts},
                "movement_id": mv["id"], "pass": not ev_problems, "problems": ev_problems,
            })
        serious = [a["code"] for a in all_alerts if a["severity"] in SERIOUS]
        if scn["kind"] == "honest" and serious:
            problems.append(f"false alarm: {serious}")
        expected_codes = [c for e in scn["events"] for c in e.get("expect", {}).get("alerts", [])]
        raised = {a["code"] for a in all_alerts}
        ledger = client.get(f"/api/permits/{permit['id']}/ledger").raise_for_status().json()
        results.append({
            "id": sid, "name": scn["name"], "kind": scn["kind"], "why": scn.get("why"),
            "real_case": scn.get("real_case"), "rules": scn.get("rules"), "format": "trip", "permit_id": permit["id"],
            "events": events,
            "expected": {"alerts": expected_codes},
            "actual": {"caught_by": sorted(raised), "serious": sorted(set(serious))},
            "caught": bool(expected_codes) and all(c in raised for c in expected_codes),
            "ledger": ledger, "pass": not problems, "problems": problems,
        })
    honest = [r for r in results if r["kind"] == "honest"]
    tamper = [r for r in results if r["kind"] == "tamper"]
    summary = {
        "total": len(results),
        "passed": sum(r["pass"] for r in results),
        "tamper_total": len(tamper),
        "tamper_caught": sum(r["caught"] for r in tamper),
        "honest_total": len(honest),
        "false_alarms": sum(bool(r["actual"]["serious"]) for r in honest),
    }
    return results, summary


# ================================================================ main
def main(suite: str) -> int:
    path = SCENARIO_DIR / f"{suite}.yaml"
    if not path.exists():
        print(f"No scenario file {path}")
        return 2
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    fmt = spec.get("format", "single")
    if any("type" in scn for scn in spec.get("scenarios", [])):  # GB RFID / edge suite (trip_auth_full)
        import auth_run

        return auth_run.main(suite)

    with httpx.Client(base_url=BACKEND, timeout=30) as client:
        registry = load_registry(client)
        STICKERS.update(load_stickers(client))
        run = client.post("/api/sim-runs", json={"suite": suite}).raise_for_status().json()
        print(f"\nSiteWatch simulator | suite: {suite} ({fmt}) | run #{run['id']} | "
              f"identify mode: {run['identify_mode']}")
        print(f"{spec.get('description', '')}\n")
        results, summary = (run_trip if fmt == "trip" else run_single)(client, spec, run, registry)
        client.put(f"/api/sim-runs/{run['id']}", json={**summary, "results": results}).raise_for_status()

    width = max(len(r["name"]) for r in results)
    for r in results:
        verdict = "PASS" if r["pass"] else "FAIL"
        if fmt == "trip":
            caught = ", ".join(r["actual"]["caught_by"]) or "-"
            print(f" {r['id']:<4} {r['name']:<{width}}  {verdict}   alerts: {caught}")
        else:
            caught = ", ".join(r["actual"]["caught_by"]) or "-"
            print(f" {r['id']:<4} {r['name']:<{width}}  {r['actual']['result']:<15} {verdict}   caught by: {caught}")
        for p in r["problems"]:
            print(f"       ! {p}")
    print("-" * (width + 60))
    print(
        f" Scenarios passed {summary['passed']}/{summary['total']}   |   "
        f"Tampering caught {summary['tamper_caught']}/{summary['tamper_total']}   |   "
        f"False alarms {summary['false_alarms']}/{summary['honest_total']}\n"
    )
    return 0 if summary["passed"] == summary["total"] else 1


def main_site(name: str) -> int:
    import site_run

    with httpx.Client(base_url=BACKEND, timeout=60) as client:
        return site_run.main(name, client, load_registry(client))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "site":
        sys.exit(main_site(sys.argv[2]))
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    try:
        sys.exit(main(sys.argv[1]))
    except ScenarioError as exc:
        print(f"Scenario error: {exc}", file=sys.stderr)
        sys.exit(1)
