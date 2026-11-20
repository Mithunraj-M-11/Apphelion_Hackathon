"""Identify step: decide which truck a gate event is, from plate + FASTag + radar length.

We assume the sensors report faithfully what is physically on the truck. Tampering (fake plates, stolen tags,
removed identifiers) happens in the physical world; these checks are what expose it.

Every check is evaluated and recorded (passed / failed / not_applicable), so the result always says WHICH check
caught a problem. Matching is exact only: an unclear plate is never "corrected" to the nearest registered one.

Mode `strict` (current): plate, FASTag and length must all be present and consistent to identify a truck.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Truck
from app.services.plates import normalise_plate, plate_type
from app.services.registry import compute_authorisation

LENGTH_TOLERANCE_M = 0.5
MODES = ("strict",)

PASS, FAIL, NA = "passed", "failed", "not_applicable"


@dataclass
class Reading:
    plate_read: str | None
    fastag_read: str | None
    radar_length_m: float | None


@dataclass
class Check:
    name: str
    status: str
    detail: str

    def as_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class Decision:
    result: str
    truck: Truck | None
    plate_normalised: str | None
    checks: list[Check] = field(default_factory=list)
    caught_by: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


def evaluate(
    reading: Reading,
    plate_truck: Truck | None,
    tag_truck: Truck | None,
    *,
    mode: str = "strict",
    authorise: Callable[[Truck], dict] = compute_authorisation,
    tolerance_m: float = LENGTH_TOLERANCE_M,
) -> Decision:
    """Pure decision logic (no DB): registry lookups are passed in, so it can be unit-tested directly."""
    if mode not in MODES:
        raise ValueError(f"Unknown identify mode '{mode}' (supported: {', '.join(MODES)})")

    checks: list[Check] = []
    plate = normalise_plate(reading.plate_read) if reading.plate_read else None
    plate_ok = bool(plate) and plate_type(plate) is not None

    # 1. Plate present / valid format
    checks.append(Check("plate_present", PASS if plate else FAIL,
                        f"Plate read: {plate}" if plate else "No plate read (missing, covered or removed)"))
    if not plate:
        checks.append(Check("plate_format", NA, "No plate to check"))
    else:
        checks.append(Check("plate_format", PASS if plate_ok else FAIL,
                            "Valid Indian plate format" if plate_ok else f"'{plate}' is not a valid Indian plate"))

    # 2. Plate in registry (exact match only)
    if not plate_ok:
        checks.append(Check("registry", NA, "No valid plate to look up"))
    elif plate_truck:
        checks.append(Check("registry", PASS, f"{plate} is registered (truck #{plate_truck.id})"))
    else:
        checks.append(Check("registry", FAIL, f"{plate} is not in the GB registry"))

    # 3. FASTag present / in registry
    tag = (reading.fastag_read or "").strip() or None
    checks.append(Check("fastag_present", PASS if tag else FAIL,
                        f"FASTag read: {tag}" if tag else "No FASTag read (missing, removed or blocked)"))
    if not tag:
        checks.append(Check("fastag_registry", NA, "No FASTag to look up"))
    elif tag_truck:
        checks.append(Check("fastag_registry", PASS, f"FASTag belongs to {tag_truck.plate} (truck #{tag_truck.id})"))
    else:
        checks.append(Check("fastag_registry", FAIL, "FASTag is not registered to any truck"))

    # 4. Plate and FASTag point to the same truck
    if plate_truck and tag_truck:
        same = plate_truck.id == tag_truck.id
        checks.append(Check("plate_fastag", PASS if same else FAIL,
                            "Plate and FASTag match the same truck" if same else
                            f"Plate says {plate_truck.plate} but FASTag belongs to {tag_truck.plate}"))
    else:
        checks.append(Check("plate_fastag", NA, "Needs both a registered plate and a registered FASTag"))

    # 5. Radar length vs the enrolled length of the claimed truck (plate identity first, else tag identity)
    claimed = plate_truck or tag_truck
    if claimed is None:
        checks.append(Check("length", NA, "No registered truck to compare against"))
    elif reading.radar_length_m is None:
        checks.append(Check("length", FAIL, "No radar length measured"))
    else:
        diff = abs(reading.radar_length_m - claimed.length_m)
        ok = diff <= tolerance_m
        checks.append(Check("length", PASS if ok else FAIL,
                            f"Radar {reading.radar_length_m:.2f} m vs enrolled {claimed.length_m:.2f} m "
                            f"(difference {diff:.2f} m, tolerance {tolerance_m} m)"))

    status = {c.name: c.status for c in checks}
    failed = [c for c in checks if c.status == FAIL]

    # ---- Result, by precedence ----
    if status["plate_fastag"] == FAIL or (claimed is not None and status["length"] == FAIL
                                          and reading.radar_length_m is not None):
        result = "MISMATCH"
    elif status["registry"] == FAIL or (status["fastag_registry"] == FAIL and plate_truck is None):
        result = "UNREGISTERED"
    elif failed or claimed is None:
        # strict: anything missing or unreadable means not identified (default deny)
        result = "UNIDENTIFIED"
    else:
        result = "IDENTIFIED"

    caught_by = [c.name for c in failed]
    reasons = [c.detail for c in failed]
    flags: list[str] = []
    if status["plate_present"] == FAIL:
        flags.append("PLATE_MISSING")
    if status["fastag_present"] == FAIL:
        flags.append("TAG_MISSING")
    if result == "MISMATCH":
        flags.append("POSSIBLE_CLONE")

    if result == "UNIDENTIFIED":
        caught_by.append("default_deny")
        reasons.append("Not positively identified, so not allowed (default deny)")

    truck = claimed
    if result == "IDENTIFIED":
        auth = authorise(truck)
        if auth["authorised"]:
            checks.append(Check("authorisation", PASS, "Authorised to work today"))
            result = "AUTHORISED"
        else:
            checks.append(Check("authorisation", FAIL, "; ".join(auth["reasons"])))
            result = "NOT_AUTHORISED"
            caught_by.append("authorisation")
            reasons.extend(auth["reasons"])
    else:
        checks.append(Check("authorisation", NA, "Truck not identified"))

    return Decision(result, truck, plate, checks, caught_by, reasons, flags)


def identify(db: Session, reading: Reading, mode: str = "strict") -> Decision:
    """Look the readings up in the registry (exact matches) and decide."""
    plate = normalise_plate(reading.plate_read) if reading.plate_read else None
    plate_truck = db.scalar(select(Truck).where(Truck.plate == plate)) if plate else None
    tag = (reading.fastag_read or "").strip()
    tag_truck = (
        db.scalar(select(Truck).where(or_(Truck.fastag_tag_id == tag, Truck.fastag_chip_id == tag))) if tag else None
    )
    return evaluate(reading, plate_truck, tag_truck, mode=mode)


# ---------------------------------------------------------------- human-readable log lines
CHECK_LABEL = {
    "plate_present": "Plate present",
    "plate_format": "Plate format",
    "registry": "Plate in registry",
    "fastag_present": "FASTag present",
    "fastag_registry": "FASTag in registry",
    "plate_fastag": "Plate vs FASTag",
    "length": "Radar length",
    "authorisation": "Authorisation",
}

RESULT_LEVEL = {
    "AUTHORISED": "INFO",
    "NOT_AUTHORISED": "WARN",
    "UNREGISTERED": "ALERT",
    "UNIDENTIFIED": "ALERT",
    "MISMATCH": "ALERT",
}


def describe(decision: Decision) -> list["LogLine"]:
    """Log lines for an Identify decision: one per evaluated check, then the result. Pure (no I/O)."""
    from app.services.logbus import LogLine  # local import keeps evaluate() free of logging concerns

    lines = []
    for c in decision.checks:
        if c.status == NA:
            continue
        level = "INFO" if c.status == PASS else "WARN"
        lines.append(LogLine("IDENTIFY", level, f"{CHECK_LABEL.get(c.name, c.name)}: {c.status}. {c.detail}",
                             {"check": c.name, "status": c.status}))
    who = f" (claims truck #{decision.truck.id} {decision.truck.plate})" if decision.truck else ""
    caught = f"; caught by {', '.join(decision.caught_by)}" if decision.caught_by else ""
    flags = f"; flags {', '.join(decision.flags)}" if decision.flags else ""
    lines.append(LogLine("IDENTIFY", RESULT_LEVEL.get(decision.result, "INFO"),
                         f"Result {decision.result}{who}{caught}{flags}",
                         {"result": decision.result, "caught_by": decision.caught_by, "flags": decision.flags}))
    return lines
