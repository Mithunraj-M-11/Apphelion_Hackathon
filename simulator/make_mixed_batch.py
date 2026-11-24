"""Build the mixed_batch suite: 300 stories mixing a wide range of cheats with honest trips, in a shuffled order.

    python make_mixed_batch.py            writes scenarios/mixed_batch.yaml (same seed, same 300 stories)

Built from the stories of gate_cheats and threat_coverage, so each case behaves as in its own suite:
  - every cheat story about three times and every officer story a few times; stories that don't depend on a
    particular truck are replayed with other registered trucks (the plates are swapped consistently in the story);
  - the honest stories a few times each, plus generated honest trips (random truck, load and time, some with a
    sensor miss or a WIM fault, which the GB must let through);
  - stories tied to one truck (suspended, revoked or unauthorised truck, transplants tuned to a truck's weight and
    axles) keep their own plates;
  - a few cheats the GB flags but can't prove: a bribed officer letting out two side-track trucks, each let-out
    flagged with the officer's name, below the three-a-day pattern threshold;
  - left out: the same-model transplant (W2b). It needs the GB sticker moved intact (windscreen swapped) and is
    staged, and stated as a known limit, in threat_coverage.
"""

import copy
import random
from pathlib import Path

import yaml

HERE = Path(__file__).parent / "scenarios"
SEED = 300
N_CHEAT, N_FLAGGED, N_OFFICER, N_HONEST_TEMPLATE, N_HONEST_NEW = 175, 5, 15, 36, 69
EXCLUDE = {"W2b"}  # known limit, kept in threat_coverage

# A cheat the GB flags but can't prove: a bribed officer lets out two trucks that went round by side tracks. Each
# let-out is an OFFICER_EXIT alert naming the officer, but the bribery pattern needs three overrides in a day.
FLAGGED = {
    "id": "F1", "name": "Bribed officer lets out two side-track trucks (below the pattern threshold)",
    "kind": "tamper", "category": "officer", "threat": "E5", "priority": "P1",
    "why": "Each let-out is flagged with the officer's name and counted with its weight, but two overrides in a day "
           "don't make a pattern yet: the GB flags the acts, it can't prove the bribery.",
    "expect_story": {"alerts": ["OFFICER_OVERRIDE_PATTERN"]},
    "events": [
        {"at": "07:00", "dir": "IN", "vehicle": "OD09AC5678", "expect": {"barrier": "up"}},
        {"at": "07:05", "dir": "IN", "vehicle": "OD09AD0090", "expect": {"barrier": "up"}},
        {"at": "08:00", "unseen": "both leave loaded by a side track and come back for a second load",
         "vehicle": "OD09AC5678"},
        {"at": "10:00", "dir": "OUT", "vehicle": "OD09AC5678", "expect": {"barrier": "down", "alerts": ["PASS_EXPIRED_AT_EXIT"]}},
        {"at": "10:02", "officer": "let_out", "event": 4, "reason": "sensor fault"},
        {"at": "10:05", "dir": "OUT", "vehicle": "OD09AD0090", "expect": {"barrier": "down", "alerts": ["PASS_EXPIRED_AT_EXIT"]}},
        {"at": "10:07", "officer": "let_out", "event": 6, "reason": "sensor fault"},
    ],
    "template": "batch:F1",
}

# authorised, active GB sticker, not used for a special state: free to stand in for one another
POOL = ["22BH4581AB", "CG04MN5507", "JH05CK2290", "JH05CL6614", "OD02BR7120", "OD09AC5678", "OD09AD0090",
        "OD09AE4521", "OD09AF7733", "OD09AG1180", "OD09AH2468", "OD09AJ3579", "OD09AK6402", "OD09AL9015",
        "OD11CE3305", "OD14DF8821"]
# a story that names one of these keeps its plates: the truck's state or weight is the point of the story
FIXED = ["OD09AM1111", "OD02BQ4410", "OD09AN2025", "OD09AB1234"]
ALL_PLATES = POOL + FIXED


def plates_in(text: str) -> list[str]:
    return [p for p in ALL_PLATES if p in text]


def vary(story: dict, rng: random.Random) -> dict:
    """The same story with other registered trucks (consistently swapped), unless it is tied to one truck."""
    text = yaml.safe_dump(story, sort_keys=False, allow_unicode=True)
    used = plates_in(text)
    if not used or any(p in FIXED for p in used) or any(r in text for r in ("transplant_", "rogue_same_size")):
        return copy.deepcopy(story)
    new = rng.sample(POOL, len(used))
    for old, tmp in zip(used, (f"@@{i}@@" for i in range(len(used)))):
        text = text.replace(old, tmp)
    for i, p in enumerate(new):
        text = text.replace(f"@@{i}@@", p)
    return yaml.safe_load(text)


def honest_trip(n: int, rng: random.Random) -> dict:
    """A generated honest trip: a registered truck in, loads, out. Some meet a sensor fault the GB must tolerate."""
    plate = rng.choice(POOL)
    start = rng.randint(6 * 60 + 15, 14 * 60)
    out = start + rng.randint(40, 120)
    hm = lambda m: f"{m // 60:02d}:{m % 60:02d}"  # noqa: E731
    entry = {"at": hm(start), "dir": "IN", "vehicle": plate, "expect": {"barrier": "up", "pass_issued": True}}
    exit_ = {"at": hm(out), "dir": "OUT", "vehicle": plate, "load": f"{rng.randint(60, 95)}%",
             "expect": {"barrier": "up", "trip": "LEGAL"}}
    fault, roll = None, rng.random()
    if roll < 0.10:
        entry["camera"], fault = "unreadable", "the camera can't read the plate at entry"
    elif roll < 0.18:
        exit_["fastag_reader"], fault = "missed", "the FASTag reader misses the tag at exit"
    elif roll < 0.24:
        exit_["wim"], fault = "poor", "the driver brakes on the WIM strip at exit"
    elif roll < 0.28:
        entry["wim"], fault = "offline", "the WIM strip is offline at entry"
    elif roll < 0.36:
        exit_["pass"] = "sms"
        fault = "the driver gives the SMS code instead of the QR"
    return {
        "id": f"H{n:03d}", "name": f"Honest trip, {plate}" + (f" ({fault})" if fault else ""),
        "kind": "honest", "category": "control",
        "why": "An honest truck doing its job" + (f"; {fault}, which must not count against it." if fault else "."),
        "events": [entry, exit_],
    }


def main() -> None:
    rng = random.Random(SEED)
    rogues, cheats, honest, officer = {}, [], [], []
    for suite in ("gate_cheats", "threat_coverage"):
        spec = yaml.safe_load((HERE / f"{suite}.yaml").read_text(encoding="utf-8"))
        rogues.update(spec.get("rogue_vehicles", {}))
        for s in spec["scenarios"]:
            if s["id"] in EXCLUDE:
                continue
            s = {**s, "template": f"{suite}:{s['id']}"}
            {"tamper": cheats, "honest": honest, "officer": officer}[s["kind"]].append(s)

    def draw(templates: list[dict], n: int) -> list[dict]:
        out = [templates[i % len(templates)] for i in range(n)]  # every template, evenly
        return [vary(s, rng) for s in out]

    stories = draw(cheats, N_CHEAT) + draw([FLAGGED], N_FLAGGED) + draw(officer, N_OFFICER) +         draw(honest, N_HONEST_TEMPLATE)
    stories += [honest_trip(i + 1, rng) for i in range(N_HONEST_NEW)]
    rng.shuffle(stories)
    for i, s in enumerate(stories, start=1):
        s["name"] = f"{s['name']}" + (f" [{s['template'].split(':')[1]}]" if "template" in s else "")
        s["id"] = f"M{i:03d}"
    spec = {
        "suite": "mixed_batch",
        "title": "Mixed batch (300 stories)",
        "format": "trip",
        "description": "300 stories in a shuffled order: every cheat from the regression and threat suites about three "
                       "times over (with other trucks where the story allows), a few the GB can only flag in general, "
                       "officer actions, and honest trips with the sensor faults the GB must tolerate. Generated by "
                       "make_mixed_batch.py (seed 300).",
        "gate": "G1",
        "heartbeats": True,
        "permit": {"trip_limit": 50, "tonne_limit": 1500, "vehicle_limit": 20, "hours_start": "06:00",
                   "hours_end": "18:00", "exit_grace_min": 30, "pass_expiry_min": 120},
        "rogue_vehicles": rogues,
        "scenarios": stories,
    }
    header = "# Generated by make_mixed_batch.py: edit that script, not this file.\n"
    (HERE / "mixed_batch.yaml").write_text(header + yaml.safe_dump(spec, sort_keys=False, allow_unicode=True,
                                                                     width=120), encoding="utf-8")
    kinds = {k: sum(1 for s in stories if s["kind"] == k) for k in ("tamper", "officer", "honest")}
    print(f"mixed_batch.yaml: {len(stories)} stories {kinds}")


if __name__ == "__main__":
    main()
