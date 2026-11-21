"""Trip session lifecycle management service.

Handles:
- Creation of authorized entry trip sessions with cryptographically signed internal QR tokens
- Verification and transactional completion of exit movements with exactly-once quota deduction
- Handling of expired / unresolved trips
- Sync-outbox event recording
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.gate import Movement
from app.models.logs import EventLog
from app.models.registry import Officer, Truck
from app.models.rfid import RfidSticker
from app.models.trip import TripSession, VehicleQuota
from app.models.edge import SyncOutbox
from app.services import logbus
from app.services.logbus import LogLine
from app.services.qr_tokens import generate_trip_token, verify_trip_token
from app.services.rfid_auth import authenticate_sticker

PASS, FAIL, WARN, NA = "passed", "failed", "warning", "not_applicable"
TRIP_VALIDITY_HOURS = 12


@dataclass
class ExitCheck:
    name: str
    status: str
    detail: str

    def as_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class ExitVerificationResult:
    decision: str  # EXIT AUTHORIZED | EXIT REJECTED | MANUAL REVIEW REQUIRED
    passed: bool
    reasons: list[str]
    checks: list[ExitCheck]
    session: TripSession | None
    quota_before: int | None
    quota_after: int | None
    exit_movement: Movement | None


def create_trip_session(
    db: Session,
    truck: Truck,
    sticker: RfidSticker,
    entry_gate: str,
    entry_movement: Movement | None = None,
    officer_id: int | None = None,
    validity_hours: int = TRIP_VALIDITY_HOURS,
    notes: str | None = None,
) -> TripSession:
    """Create a new ACTIVE trip session with an unpredictable, signed internal QR token."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=validity_hours)
    session_id = f"SES-{uuid.uuid4().hex[:12].upper()}"

    # Determine next trip code
    count = db.scalar(select(TripSession.id).order_by(TripSession.id.desc()).limit(1)) or 0
    trip_code = f"TRIP-2026-{(count + 1):05d}"

    signed_token, token_hash = generate_trip_token(
        session_id=session_id,
        trip_code=trip_code,
        truck_id=truck.id,
        truck_plate=truck.plate,
        sticker_uid=sticker.uid,
        expires_at=expires_at,
    )

    session = TripSession(
        session_id=session_id,
        trip_code=trip_code,
        truck_id=truck.id,
        sticker_id=sticker.id,
        signed_token=signed_token,
        token_hash=token_hash,
        entry_gate=entry_gate,
        entry_movement_id=entry_movement.id if entry_movement else None,
        status="ACTIVE",
        entry_at=now,
        expires_at=expires_at,
        created_by=officer_id,
        notes=notes,
    )
    db.add(session)
    db.flush()

    # Outbox event
    outbox_event = SyncOutbox(
        event_type="TRIP_SESSION_CREATED",
        payload={
            "session_id": session_id,
            "trip_code": trip_code,
            "truck_plate": truck.plate,
            "sticker_uid": sticker.uid,
            "entry_gate": entry_gate,
            "entry_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        },
        status="PENDING",
    )
    db.add(outbox_event)

    # Save log
    log_line = LogLine(
        "PASS",
        "INFO",
        f"Trip pass {trip_code} issued for {truck.plate} at gate {entry_gate}. Signed token bound to sticker {sticker.uid}.",
        {"session_id": session_id, "trip_code": trip_code, "truck_plate": truck.plate, "sticker_uid": sticker.uid},
    )
    rows = logbus.save(
        db, [log_line], source="trip_pass", movement_id=entry_movement.id if entry_movement else None
    )
    logbus.publish(rows)

    return session


def verify_and_complete_exit(
    db: Session,
    gate: str,
    truck_plate: str | None,
    sticker_uid: str | None,
    qr_token: str | None = None,
    sim_auth_mode: str = "genuine",
    officer_id: int | None = None,
    source: str | None = None,
) -> ExitVerificationResult:
    """Evaluate 7 exit verification checks and complete trip with exactly-once quota deduction."""
    checks: list[ExitCheck] = []
    reasons: list[str] = []
    now = datetime.now(timezone.utc)

    # Resolve truck
    truck: Truck | None = None
    if truck_plate:
        from app.services.plates import normalise_plate
        norm_plate = normalise_plate(truck_plate)
        truck = db.scalar(select(Truck).where(Truck.plate == norm_plate))

    # 1. RFID sticker authenticated
    auth_res = authenticate_sticker(db, sticker_uid, sim_auth_mode=sim_auth_mode)
    if auth_res.authenticated:
        checks.append(ExitCheck("rfid_authentication", PASS, auth_res.detail))
    else:
        checks.append(ExitCheck("rfid_authentication", FAIL, auth_res.detail))
        reasons.append(f"Exit RFID authentication failed: {auth_res.detail}")

    sticker = auth_res.sticker

    # If truck wasn't explicitly given by plate, deduce from sticker
    if not truck and sticker:
        truck = db.scalar(select(Truck).where(Truck.id == sticker.truck_id))

    # 2. Sticker-to-vehicle association verified
    if not sticker or not truck:
        status_val = NA if not truck else FAIL
        detail = "No vehicle identified for association" if not truck else "Sticker not recognized"
        checks.append(ExitCheck("sticker_association", status_val, detail))
        if status_val == FAIL:
            reasons.append(detail)
    elif sticker.truck_id == truck.id:
        checks.append(ExitCheck(
            "sticker_association",
            PASS,
            f"Sticker {sticker.uid} verified for truck #{truck.id} ({truck.plate})",
        ))
    else:
        checks.append(ExitCheck(
            "sticker_association",
            FAIL,
            f"Exit sticker {sticker.uid} is assigned to truck #{sticker.truck_id}, not {truck.plate}",
        ))
        reasons.append(f"Exit sticker belongs to another truck (#{sticker.truck_id})")

    # 3. Active trip session found
    active_session: TripSession | None = None
    if truck:
        active_session = db.scalar(
            select(TripSession)
            .where(TripSession.truck_id == truck.id, TripSession.status == "ACTIVE")
            .order_by(TripSession.id.desc())
        )

    if not truck:
        checks.append(ExitCheck("active_trip", NA, "No identified truck"))
    elif active_session:
        checks.append(ExitCheck(
            "active_trip",
            PASS,
            f"Active trip found: {active_session.trip_code} (entered at {active_session.entry_gate} on {active_session.entry_at.strftime('%Y-%m-%d %H:%M')})",
        ))
    else:
        checks.append(ExitCheck("active_trip", FAIL, f"No active trip session found for vehicle {truck.plate}"))
        reasons.append("No active trip session exists for this truck")

    # 4. Trip session status verified (and not expired)
    if not active_session:
        checks.append(ExitCheck("session_status", NA, "No session to verify status"))
    elif active_session.status != "ACTIVE":
        checks.append(ExitCheck(
            "session_status",
            FAIL,
            f"Session {active_session.trip_code} status is {active_session.status} (cannot exit)",
        ))
        reasons.append(f"Trip session is already {active_session.status}")
    elif active_session.expires_at < now:
        # Trip expired while inside! Mark EXPIRED_UNRESOLVED
        active_session.status = "EXPIRED_UNRESOLVED"
        db.flush()
        checks.append(ExitCheck(
            "session_status",
            FAIL,
            f"Trip session {active_session.trip_code} expired on {active_session.expires_at.strftime('%Y-%m-%d %H:%M')} (marked EXPIRED_UNRESOLVED)",
        ))
        reasons.append("Trip validity window expired before exit (marked EXPIRED_UNRESOLVED)")
    else:
        checks.append(ExitCheck(
            "session_status",
            PASS,
            f"Trip session {active_session.trip_code} is ACTIVE and within validity window (expires {active_session.expires_at.strftime('%H:%M')})",
        ))

    # 5. Entry and exit sticker identity match
    if not active_session or not sticker:
        checks.append(ExitCheck("sticker_match", NA, "Cannot verify sticker continuity without session and tag"))
    elif active_session.sticker_id == sticker.id:
        checks.append(ExitCheck(
            "sticker_match",
            PASS,
            f"Exit sticker {sticker.uid} matches entry sticker #{active_session.sticker_id}",
        ))
    else:
        entry_sticker = db.scalar(select(RfidSticker).where(RfidSticker.id == active_session.sticker_id))
        entry_uid = entry_sticker.uid if entry_sticker else f"#{active_session.sticker_id}"
        checks.append(ExitCheck(
            "sticker_match",
            FAIL,
            f"Sticker mismatch: entered with {entry_uid}, attempting exit with {sticker.uid}",
        ))
        reasons.append(f"Entry/exit sticker mismatch (entered with {entry_uid}, presenting {sticker.uid})")

    # 6. QR token signature and session validity checked
    token_to_verify = qr_token or (active_session.signed_token if active_session else None)
    if not token_to_verify:
        checks.append(ExitCheck("qr_token_validity", NA, "No internal QR token provided for verification"))
    else:
        is_valid, token_msg, payload = verify_trip_token(token_to_verify)
        if not is_valid:
            checks.append(ExitCheck("qr_token_validity", FAIL, f"Invalid QR token: {token_msg}"))
            reasons.append(f"Internal QR authorization token invalid ({token_msg})")
        elif active_session and payload and payload.get("sid") != active_session.session_id:
            checks.append(ExitCheck(
                "qr_token_validity",
                FAIL,
                f"Token belongs to session {payload.get('sid')}, but active session is {active_session.session_id}",
            ))
            reasons.append("QR token belongs to a different session (possible replay)")
        else:
            checks.append(ExitCheck("qr_token_validity", PASS, f"Signed QR token verified: bound to {payload.get('plate') if payload else ''}"))

    # 7. Exit authorization decision
    failed_checks = [c for c in checks if c.status == FAIL]
    if failed_checks or not active_session or not truck:
        checks.append(ExitCheck("final_exit_decision", FAIL, f"Exit denied: {len(reasons)} issue(s) detected"))
        final_decision = "EXIT REJECTED"
        passed = False
    else:
        checks.append(ExitCheck("final_exit_decision", PASS, "All exit verification checks passed. Quota deducted by 1."))
        final_decision = "EXIT AUTHORIZED"
        passed = True

    quota_before = None
    quota_after = None
    exit_movement = None

    if passed and active_session and truck:
        # Transactional quota deduction and session completion
        quota = db.scalar(
            select(VehicleQuota).where(VehicleQuota.truck_id == truck.id).with_for_update()
        )
        if quota:
            quota_before = quota.remaining_trips
            quota.completed_trips += 1
            quota.remaining_trips = max(0, quota.max_trips - quota.completed_trips)
            if quota.remaining_trips == 0:
                quota.status = "EXHAUSTED"
            elif quota.remaining_trips <= 5:
                quota.status = "LOW"
            quota_after = quota.remaining_trips

        # Close session
        active_session.status = "COMPLETED"
        active_session.completed_at = now
        active_session.exit_gate = gate
        active_session.closed_by = officer_id

        # Record exit movement
        exit_movement = Movement(
            gate=gate,
            direction="OUT",
            observed_at=now,
            plate_read=truck.plate,
            plate_normalised=truck.plate,
            fastag_read=truck.fastag_tag_id,
            radar_length_m=truck.length_m,
            result="AUTHORISED",
            truck_id=truck.id,
            identify_mode="strict",
            checks=[c.as_dict() for c in checks],
            caught_by=[],
            reasons=[],
            flags=[],
            source=source,
        )
        db.add(exit_movement)
        db.flush()

        active_session.exit_movement_id = exit_movement.id

        # Record outbox event
        outbox_event = SyncOutbox(
            event_type="TRIP_COMPLETED_QUOTA_DEDUCTED",
            payload={
                "session_id": active_session.session_id,
                "trip_code": active_session.trip_code,
                "truck_plate": truck.plate,
                "exit_gate": gate,
                "completed_at": now.isoformat(),
                "quota_remaining": quota_after,
                "closed_by_officer_id": officer_id,
            },
            status="PENDING",
        )
        db.add(outbox_event)

        # Log to logbus
        lines = [
            LogLine("POLE", "INFO", f"{gate} OUT: vehicle {truck.plate} exit verified. GB sticker {sticker.uid if sticker else 'none'}.", {"plate": truck.plate}),
            LogLine("PASS", "INFO", f"Trip {active_session.trip_code} marked COMPLETED. Vehicle quota remaining: {quota_after} of {quota.max_trips if quota else 100}.", {"trip_code": active_session.trip_code, "quota_remaining": quota_after}),
        ]
        rows = logbus.save(db, lines, source=source, movement_id=exit_movement.id)
        db.commit()
        logbus.publish(rows)
    else:
        db.commit()

    return ExitVerificationResult(
        decision=final_decision,
        passed=passed,
        reasons=reasons,
        checks=checks,
        session=active_session,
        quota_before=quota_before,
        quota_after=quota_after,
        exit_movement=exit_movement,
    )
