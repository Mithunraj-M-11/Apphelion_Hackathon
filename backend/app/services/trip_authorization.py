"""GB Trip Authorization evaluation service for gate entry.

Performs the 8 GB-specific trip authorization checks alongside the existing
Identify step results to compute the final entry decision.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.registry import Truck
from app.models.rfid import RfidSticker
from app.models.trip import TripSession, VehicleQuota
from app.services.identify import Decision as IdentifyDecision
from app.services.rfid_auth import RfidAuthResult, authenticate_sticker

PASS, FAIL, WARN, NA = "passed", "failed", "warning", "not_applicable"


@dataclass
class TripCheck:
    name: str
    status: str  # passed | failed | warning | not_applicable
    detail: str

    def as_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class EntryAuthorizationDecision:
    decision: str  # ENTRY AUTHORIZED | ENTRY REJECTED | MANUAL REVIEW REQUIRED
    passed: bool
    requires_manual_review: bool
    reasons: list[str]
    checks: list[TripCheck]
    auth_result: RfidAuthResult
    quota: VehicleQuota | None = None
    existing_session: TripSession | None = None
    unresolved_session: TripSession | None = None


def evaluate_entry_authorization(
    db: Session,
    identify_decision: IdentifyDecision,
    sticker_uid: str | None,
    sim_auth_mode: str = "genuine",
    manual_review_requested: bool = False,
) -> EntryAuthorizationDecision:
    """Evaluate the 8 GB Trip Authorization checks for an arriving truck.

    Checks:
      1. rfid_authentication: GB RFID sticker authentication
      2. sticker_association: Sticker-to-vehicle association
      3. sticker_status: Sticker status validation
      4. vehicle_status: Vehicle authorization status
      5. trip_quota: Trip quota availability
      6. active_trip: Existing active trip detection
      7. unresolved_trip: Unresolved trip detection
      8. final_trip_decision: Final trip authorization decision
    """
    checks: list[TripCheck] = []
    reasons: list[str] = []
    claimed_truck: Truck | None = identify_decision.truck
    today = date.today()

    # 1. RFID sticker authentication
    auth_res = authenticate_sticker(db, sticker_uid, sim_auth_mode=sim_auth_mode)
    if auth_res.authenticated:
        checks.append(TripCheck("rfid_authentication", PASS, auth_res.detail))
    else:
        checks.append(TripCheck("rfid_authentication", FAIL, auth_res.detail))
        reasons.append(f"RFID authentication failed: {auth_res.detail}")

    sticker = auth_res.sticker

    # 2. Sticker-to-vehicle association
    if not sticker or not claimed_truck:
        status_val = NA if not claimed_truck else FAIL
        detail = "No registered truck identified to match sticker" if not claimed_truck else "Sticker not found in registry"
        checks.append(TripCheck("sticker_association", status_val, detail))
        if status_val == FAIL:
            reasons.append(detail)
    elif sticker.truck_id == claimed_truck.id:
        checks.append(TripCheck(
            "sticker_association",
            PASS,
            f"Sticker {sticker.uid} is assigned to truck #{claimed_truck.id} ({claimed_truck.plate})",
        ))
    else:
        checks.append(TripCheck(
            "sticker_association",
            FAIL,
            f"Sticker {sticker.uid} belongs to truck #{sticker.truck_id}, but vehicle claimed is {claimed_truck.plate}",
        ))
        reasons.append(f"Sticker belongs to another truck (claims {claimed_truck.plate}, sticker belongs to #{sticker.truck_id})")

    # 3. Sticker status validation
    if not sticker:
        checks.append(TripCheck("sticker_status", NA, "No sticker to check status"))
    elif sticker.status == "ACTIVE":
        checks.append(TripCheck("sticker_status", PASS, f"Sticker {sticker.uid} status is ACTIVE"))
    elif sticker.status == "REVOKED":
        checks.append(TripCheck("sticker_status", FAIL, f"Sticker {sticker.uid} is REVOKED ({sticker.revocation_reason})"))
        reasons.append(f"RFID sticker is revoked: {sticker.revocation_reason or 'No reason provided'}")
    else:
        checks.append(TripCheck("sticker_status", FAIL, f"Sticker {sticker.uid} status is {sticker.status}"))
        reasons.append(f"RFID sticker status is {sticker.status}")

    # 4. Vehicle authorization status
    if not claimed_truck:
        checks.append(TripCheck("vehicle_status", NA, "Truck not identified"))
    elif claimed_truck.status == "active":
        if claimed_truck.valid_from and claimed_truck.valid_to:
            if claimed_truck.valid_from <= today <= claimed_truck.valid_to:
                checks.append(TripCheck("vehicle_status", PASS, f"Vehicle authorization valid until {claimed_truck.valid_to}"))
            else:
                checks.append(TripCheck("vehicle_status", FAIL, f"Vehicle authorization window expired on {claimed_truck.valid_to}"))
                reasons.append(f"Vehicle authorization window expired ({claimed_truck.valid_to})")
        else:
            checks.append(TripCheck("vehicle_status", PASS, "Vehicle status is active in GB registry"))
    else:
        checks.append(TripCheck("vehicle_status", FAIL, f"Vehicle status is {claimed_truck.status}: {claimed_truck.status_reason or 'Not active'}"))
        reasons.append(f"Vehicle is {claimed_truck.status} ({claimed_truck.status_reason})")

    # 5. Trip quota availability
    quota: VehicleQuota | None = None
    if claimed_truck:
        quota = db.scalar(select(VehicleQuota).where(VehicleQuota.truck_id == claimed_truck.id))

    if not claimed_truck:
        checks.append(TripCheck("trip_quota", NA, "No identified truck to check quota"))
    elif not quota:
        checks.append(TripCheck("trip_quota", WARN, "No quota record found for vehicle (manual review recommended)"))
        reasons.append("No quota record assigned to this vehicle")
    elif quota.remaining_trips <= 0 or quota.status == "EXHAUSTED":
        checks.append(TripCheck("trip_quota", FAIL, f"Trip quota exhausted: {quota.completed_trips}/{quota.max_trips} trips completed (0 remaining)"))
        reasons.append("Trip quota exhausted (0 remaining)")
    elif quota.valid_to and quota.valid_to < today:
        checks.append(TripCheck("trip_quota", FAIL, f"Trip quota expired on {quota.valid_to}"))
        reasons.append(f"Trip quota validity period expired on {quota.valid_to}")
    elif quota.status == "LOW" or quota.remaining_trips <= 5:
        checks.append(TripCheck("trip_quota", WARN, f"Quota low: {quota.remaining_trips} of {quota.max_trips} trips remaining"))
    else:
        checks.append(TripCheck("trip_quota", PASS, f"Quota available: {quota.remaining_trips} of {quota.max_trips} trips remaining"))

    # 6. Existing active trip detection
    existing_session: TripSession | None = None
    if claimed_truck:
        existing_session = db.scalar(
            select(TripSession).where(
                TripSession.truck_id == claimed_truck.id,
                TripSession.status == "ACTIVE",
            )
        )

    if not claimed_truck:
        checks.append(TripCheck("active_trip", NA, "No identified truck"))
    elif existing_session:
        checks.append(TripCheck(
            "active_trip",
            FAIL,
            f"Active trip already in progress ({existing_session.trip_code}, entered {existing_session.entry_at.strftime('%Y-%m-%d %H:%M')})",
        ))
        reasons.append(f"Active trip already exists ({existing_session.trip_code})")
    else:
        checks.append(TripCheck("active_trip", PASS, "No active trip in progress for this truck"))

    # 7. Unresolved trip detection
    unresolved_session: TripSession | None = None
    if claimed_truck:
        unresolved_session = db.scalar(
            select(TripSession).where(
                TripSession.truck_id == claimed_truck.id,
                TripSession.status.in_(["EXPIRED_UNRESOLVED", "FLAGGED"]),
            )
        )

    if not claimed_truck:
        checks.append(TripCheck("unresolved_trip", NA, "No identified truck"))
    elif unresolved_session:
        checks.append(TripCheck(
            "unresolved_trip",
            FAIL,
            f"Vehicle has an unresolved trip ({unresolved_session.trip_code}, status {unresolved_session.status})",
        ))
        reasons.append(f"Previous trip remains unresolved ({unresolved_session.trip_code})")
    else:
        checks.append(TripCheck("unresolved_trip", PASS, "No unresolved trips recorded"))

    # 8. Final trip authorization decision
    trip_failed_checks = [c for c in checks if c.status == FAIL]
    identify_passed = identify_decision.result == "AUTHORISED"

    if not identify_passed:
        reasons.insert(0, f"Vehicle identification failed ({identify_decision.result})")

    if not identify_passed or trip_failed_checks:
        checks.append(TripCheck("final_trip_decision", FAIL, f"Trip authorization denied: {len(reasons)} issue(s) detected"))
        final_decision = "ENTRY REJECTED"
        passed = False
        requires_manual_review = False
    elif manual_review_requested or any(c.status == WARN for c in checks):
        checks.append(TripCheck("final_trip_decision", WARN, "Manual review required due to warnings"))
        final_decision = "MANUAL REVIEW REQUIRED"
        passed = False
        requires_manual_review = True
    else:
        checks.append(TripCheck("final_trip_decision", PASS, "All identification and GB trip authorization checks passed"))
        final_decision = "ENTRY AUTHORIZED"
        passed = True
        requires_manual_review = False

    return EntryAuthorizationDecision(
        decision=final_decision,
        passed=passed,
        requires_manual_review=requires_manual_review,
        reasons=reasons,
        checks=checks,
        auth_result=auth_res,
        quota=quota,
        existing_session=existing_session,
        unresolved_session=unresolved_session,
    )
