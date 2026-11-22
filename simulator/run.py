"""SiteWatch scenario simulator: plays the role of the gate poles.

Usage:  python run.py gate_cheats        every known cheat at the gates, as full-trip stories (this file)
        python run.py edge_resilience    edge failover / WAN / disaster recovery cases (see auth_run.py)
        python run.py site <scenario>    a whole contract period -> scenarios/site/<scenario>.yaml (see site_run.py)

A story is a short sequence of timed gate events (entry, exit, ...) and officer actions under a small permit,
judged on every event (barrier, pass, trip, alerts). The run's scorecard is saved after every story, so the
dashboard can show progress while a run is going.

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
STICKER_STATUS: dict[str, str] = {}  # GB RFID sticker status by plate (ACTIVE, REVOKED, ...)


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


# ================================================================ stories
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


def officer_headers(client: httpx.Client) -> dict:
    """Officer actions are attributed to an officer: the first active one (no login in the PoC)."""
    officers = client.get("/api/officers").raise_for_status().json()
    active = [o for o in officers if o.get("active")]
    if not active:
        raise ScenarioError("no active GB officer to act in officer stories")
    return {"X-Officer-Id": str(active[0]["id"])}


def officer_action(client, ev: dict, sid: str, permit: dict, observed: datetime, movements: dict[int, dict],
                   headers: dict, sent: list[dict]) -> tuple[dict | None, str]:
    """One officer action. Returns (the gate decision it produced, if any; what the officer did). Appends the
    request it made to `sent`."""
    action, reason = ev["officer"], ev.get("reason", f"Scenario {sid}: checked in person")
    if action == "let_out":
        refused = movements.get(ev["event"])
        if refused is None:
            raise ScenarioError(f"{sid}: let_out refers to event {ev['event']}, which is not a gate event")
        body = {"reason": reason, "observed_at": observed.isoformat()}
        sent.append({"method": "POST", "path": f"/api/movements/{refused['id']}/officer-exit", "headers": headers,
                     "body": body})
        mv = client.post(f"/api/movements/{refused['id']}/officer-exit", headers=headers, json=body).raise_for_status().json()
        return mv, f"lets out the truck refused at event {ev['event']}"
    plate = ev["vehicle"]
    if action == "release_hold":
        holds = client.get("/api/holds", params={"permit_id": permit["id"]}).raise_for_status().json()
        mine = [h for h in holds if h["truck"]["plate"] == plate]
        if not mine:
            raise ScenarioError(f"{sid}: no active hold on {plate} to release")
        for h in mine:
            sent.append({"method": "POST", "path": f"/api/holds/{h['id']}/release", "headers": headers,
                         "body": {"reason": reason}})
            client.post(f"/api/holds/{h['id']}/release", headers=headers, json={"reason": reason}).raise_for_status()
        return None, f"releases the hold on {plate} ({', '.join(h['reason_code'] for h in mine)})"
    if action == "late_close":
        trips = client.get("/api/trips", params={"permit_id": permit["id"],
                                                 "status": "ACTIVE,EXPIRED_UNRESOLVED,FLAGGED"}).raise_for_status().json()
        mine = [t for t in trips if (t.get("truck") or {}).get("plate") == plate]
        if not mine:
            raise ScenarioError(f"{sid}: no open or unresolved trip of {plate} to close")
        sent.append({"method": "POST", "path": f"/api/trips/{mine[0]['session_id']}/resolve", "headers": headers,
                     "query": {"action": "RESOLVE", "reason": reason}})
        client.post(f"/api/trips/{mine[0]['session_id']}/resolve", headers=headers,
                    params={"action": "RESOLVE", "reason": reason}).raise_for_status()
        return None, f"late-closes {mine[0]['trip_code']} of {plate}"
    raise ScenarioError(f"{sid}: unknown officer action {action}")


def _registered_card(t: dict) -> dict:
    """What the GB registry says about a truck, at run time."""
    auth = t.get("authorisation") or {}
    return {
        "registered": True, "plate": t["plate"], "make": t.get("make"), "model": t.get("model"),
        "transporter": (t.get("transporter") or {}).get("name"), "fastag": t.get("fastag_tag_id"),
        "gb_sticker": STICKERS.get(t["plate"]), "gb_sticker_status": STICKER_STATUS.get(t["plate"]),
        "length_m": t.get("length_m"), "empty_weight_t": t.get("empty_weight_t"),
        "rated_capacity_t": t.get("rated_capacity_t"), "status": t.get("status"),
        "authorised": auth.get("authorised"), "not_authorised_because": auth.get("reasons") or None,
    }


def _physical(ev: dict) -> dict:
    """What is physically at the barrier, with every default written out (the suite file only lists changes)."""
    def who(x):
        return x if isinstance(x, str) else f"rogue:{x['rogue']}"

    def taken(x, kind):
        return x if isinstance(x, str) else f"{kind} {x['from']}"

    out = {
        "vehicle": who(ev["vehicle"]),
        "plate_shown": ev.get("plate_shown", "own"),
        "fastag": taken(ev.get("fastag", "own"), "taken from"),
        "gb_sticker": taken(ev.get("sticker", "own"), "the sticker of"),
        "sticker_chip": ev.get("rfid", "genuine"),
        "load": ev.get("load", 0 if ev["dir"] == "IN" else "90%"),
        "breaks_through_if_refused": bool(ev.get("forces")),
    }
    if ev["dir"] == "OUT":
        p = ev.get("pass", "qr")
        out["shows_at_exit"] = p if isinstance(p, str) else {"qr_from": "QR from event", "sms_from": "SMS code from event",
                                                            "tampered_qr_from": "edited QR from event"}[
            next(iter(p))] + f" {next(iter(p.values()))}"
    if ev.get("note"):
        out["note"] = ev["note"]
    return out


def scenario_sheet(spec: dict, scn: dict, rogues: dict, registry: dict, permit: dict, steps: list[dict],
                   verdict: dict) -> dict:
    """Everything about one story in one document: the scenario, the contract it ran under, the vehicles involved
    (registry snapshot), every step (physically there -> pole reported -> GB decided, expected vs actual) and the
    verdict. Shown in the dashboard's "Scenario sheet" popup, as a read-out or as this JSON."""
    plates: set[str] = set()
    rogue_names: set[str] = set()
    for ev in scn["events"]:
        v = ev.get("vehicle")
        if isinstance(v, dict):
            rogue_names.add(v["rogue"])
        elif isinstance(v, str):
            plates.add(v)
        for k in ("fastag", "sticker"):
            if isinstance(ev.get(k), dict):
                plates.add(ev[k]["from"])
        if isinstance(ev.get("plate_shown"), str) and ev["plate_shown"] not in ("own", "none"):
            plates.add(ev["plate_shown"])
    vehicles = {p: _registered_card(registry[p]) for p in sorted(plates) if p in registry}
    for name in sorted(rogue_names):
        r = rogues.get(name, {})
        vehicles[f"rogue:{name}"] = {"registered": False, "own_plate": r.get("own_plate"), "length_m": r.get("length_m"),
                                     "empty_weight_t": r.get("empty_weight_t", 12.0),
                                     "rated_capacity_t": r.get("rated_capacity_t", 25.0), "gb_sticker": None}
    return {
        "scenario": {"suite": spec.get("suite"), "id": scn["id"], "name": scn["name"], "kind": scn["kind"],
                     "category": scn.get("category"), "rules": scn.get("rules"), "real_case": scn.get("real_case"),
                     "why": scn.get("why")},
        "contract": {k: permit.get(k) for k in ("trip_limit", "tonne_limit", "vehicle_limit", "per_vehicle_trips",
                                                "hours_start", "hours_end", "exit_grace_min", "pass_expiry_min")},
        "vehicles": vehicles,
        "steps": steps,
        "verdict": verdict,
        "as_written": scn,
    }


def summarise(results: list[dict]) -> dict:
    honest = [r for r in results if r["kind"] == "honest"]
    tamper = [r for r in results if r["kind"] == "tamper"]
    return {
        "total": len(results),
        "passed": sum(r["pass"] for r in results),
        "tamper_total": len(tamper),
        "tamper_caught": sum(r["caught"] for r in tamper),
        "honest_total": len(honest),
        "false_alarms": sum(bool(r["actual"]["serious"]) for r in honest),
    }


def run_trip(client, spec, run, registry) -> tuple[list[dict], dict]:
    gate = spec.get("gate", "G1")
    rogues = spec.get("rogue_vehicles", {})
    today = datetime.now(IST).date()
    headers = officer_headers(client)
    results = []
    for scn in spec["scenarios"]:
        sid = scn["id"]
        source = f"sim:{run['id']}:{sid}"
        permit = create_permit(client, f"Sim run {run['id']} {sid}", source,
                               {**spec.get("permit", {}), **scn.get("permit", {})})
        own_pass: dict[str, dict] = {}  # vehicle label -> its latest pass (what is on the driver's phone)
        issued: dict[int, dict] = {}  # event number -> pass issued at that event
        movements: dict[int, dict] = {}  # event number -> gate decision
        events, all_alerts, problems = [], [], []
        sent: list[dict] = []  # exactly what was sent to the backend
        steps: list[dict] = []  # the scenario sheet's timeline
        for n, ev in enumerate(scn["events"], start=1):
            before = len(sent)
            if "officer" in ev:
                hh, mm = map(int, ev["at"].split(":"))
                observed = datetime.combine(today, time(hh, mm), tzinfo=IST)
                mv, did = officer_action(client, ev, sid, permit, observed, movements, headers, sent)
                exp = ev.get("expect", {})
                ev_problems = judge_event(exp, mv) if mv else []
                problems += [f"event {n}: {p}" for p in ev_problems]
                alerts = [{"code": a["code"], "severity": a["severity"], "message": a["message"]}
                          for a in (mv or {}).get("alerts", [])]
                all_alerts += alerts
                events.append({
                    "n": n, "at": ev["at"], "dir": "OFFICER", "vehicle": ev.get("vehicle", ""), "note": did,
                    "readings": {"plate_read": None, "fastag_read": None, "radar_length_m": None,
                                 "weight_t": (mv or {}).get("weight_t"), "shown": None, "forced": False},
                    "expected": exp,
                    "actual": {"result": (mv or {}).get("result"), "decision": (mv or {}).get("decision"),
                               "barrier": (mv or {}).get("barrier"), "trip": (mv or {}).get("trip"),
                               "pass_issued": None, "pass": ((mv or {}).get("pass") or {}).get("code"),
                               "alerts": alerts},
                    "movement_id": (mv or {}).get("id"), "pass": not ev_problems, "problems": ev_problems,
                })
                steps.append({
                    "n": n, "at": ev["at"], "actor": "officer",
                    "officer_action": {"action": ev["officer"], "vehicle": ev.get("vehicle"), "refused_event": ev.get("event"),
                                       "officer_id": headers.get("X-Officer-Id"), "did": did},
                    "requests": sent[before:],
                    "expected": exp,
                    "actual": {"barrier": (mv or {}).get("barrier"), "trip": (mv or {}).get("trip"),
                               "alerts": [f"{a['code']} ({a['severity']})" for a in alerts]} if mv else {"done": did},
                    "pass": not ev_problems, "problems": ev_problems,
                })
                continue
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
            shown_body = {k: (f"{v[:24]}...({len(v)} chars)" if k == "pass_token" and v else v) for k, v in body.items()}
            sent.append({"method": "POST", "path": f"/api/gates/{gate}/events", "body": shown_body})
            mv = client.post(f"/api/gates/{gate}/events", json=body).raise_for_status().json()
            movements[n] = mv
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
            steps.append({
                "n": n, "at": ev["at"], "actor": "gate", "gate": gate, "direction": ev["dir"],
                "physical": _physical(ev),
                "requests": sent[before:],
                "expected": exp,
                "actual": {"identify": mv["result"], "barrier": mv["barrier"], "decision": mv.get("trip_decision"),
                           "pass_issued": (mv.get("issued_pass") or {}).get("code"),
                           "pass_closed": (mv.get("pass") or {}).get("code") if ev["dir"] == "OUT" else None,
                           "trip": mv["trip"], "alerts": [f"{a['code']} ({a['severity']})" for a in alerts]},
                "pass": not ev_problems, "problems": ev_problems,
            })
        serious = [a["code"] for a in all_alerts if a["severity"] in SERIOUS]
        if scn["kind"] == "honest" and serious:
            problems.append(f"false alarm: {serious}")
        expected_codes = [c for e in scn["events"] for c in e.get("expect", {}).get("alerts", [])]
        raised = {a["code"] for a in all_alerts}
        ledger = client.get(f"/api/permits/{permit['id']}/ledger").raise_for_status().json()
        caught = bool(expected_codes) and all(c in raised for c in expected_codes)
        verdict = {
            "story_passes": not problems, "cheat_caught": caught if scn["kind"] == "tamper" else None,
            "expected_alerts": expected_codes, "raised_alerts": sorted(raised),
            "false_alarm": sorted(set(serious)) if scn["kind"] == "honest" and serious else None,
            "problems": problems,
            "ledger_after": {k: ledger.get(k) for k in ("trips_reserved", "trip_limit", "legal_trips", "actual_trips",
                                                        "illegal_trips", "tonnes", "tonne_limit", "active_holds")},
        }
        results.append({
            "sheet": scenario_sheet(spec, scn, rogues, registry, permit, steps, verdict),
            "id": sid, "name": scn["name"], "kind": scn["kind"], "category": scn.get("category"), "why": scn.get("why"),
            "real_case": scn.get("real_case"), "rules": scn.get("rules"), "format": "trip", "permit_id": permit["id"],
            "events": events,
            "expected": {"alerts": expected_codes},
            "actual": {"caught_by": sorted(raised), "serious": sorted(set(serious))},
            "caught": bool(expected_codes) and all(c in raised for c in expected_codes),
            "ledger": ledger, "pass": not problems, "problems": problems,
        })
        client.put(f"/api/sim-runs/{run['id']}", json={**summarise(results), "results": results,
                                                        "finished": False}).raise_for_status()
    return results, summarise(results)


# ================================================================ main
def main(suite: str) -> int:
    path = SCENARIO_DIR / f"{suite}.yaml"
    if not path.exists():
        print(f"No scenario file {path}")
        return 2
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    if any("type" in scn for scn in spec.get("scenarios", [])):  # edge suite (edge_resilience)
        import auth_run

        return auth_run.main(suite)

    with httpx.Client(base_url=BACKEND, timeout=30) as client:
        registry = load_registry(client)
        STICKERS.update(load_stickers(client))
        STICKER_STATUS.update({s["truck"]["plate"]: s["status"] for s in client.get("/api/rfid-stickers").json()
                               if s.get("truck") and s.get("status") != "REPLACED"})
        run = client.post("/api/sim-runs", json={"suite": suite}).raise_for_status().json()
        print(f"\nSiteWatch simulator | suite: {suite} | run #{run['id']} | "
              f"identify mode: {run['identify_mode']}")
        print(f"{spec.get('description', '')}\n")
        results, summary = run_trip(client, spec, run, registry)
        client.put(f"/api/sim-runs/{run['id']}", json={**summary, "results": results}).raise_for_status()

    width = max(len(r["name"]) for r in results)
    for r in results:
        verdict = "PASS" if r["pass"] else "FAIL"
        caught = ", ".join(r["actual"]["caught_by"]) or "-"
        print(f" {r['id']:<4} {r['name']:<{width}}  {verdict}   alerts: {caught}")
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
