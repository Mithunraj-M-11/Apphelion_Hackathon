"""Gate pole API: poles (real or simulated) post what they observe; the GB server decides."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Movement
from app.schemas import (
    GateEventExtendedIn,
    MovementExtendedOut,
    MovementOut,
    TripCheckOut,
    TripSessionOut,
)
from app.services import logbus
from app.services.identify import Reading, describe, identify
from app.services.logbus import LogLine
from app.services.trip_authorization import evaluate_entry_authorization
from app.services.trip_sessions import create_trip_session, verify_and_complete_exit

router = APIRouter(prefix="/api", tags=["gates"])

SIM_PREFIX = "sim:"
WALKTHROUGH_PREFIX = "walkthrough:"


def _pole_line(gate: str, body: GateEventExtendedIn) -> LogLine:
    tag = body.fastag_read
    tag_txt = f"{tag[:8]}…{tag[-4:]}" if tag and len(tag) > 12 else (tag or "none")
    length = f"{body.radar_length_m:.2f} m" if body.radar_length_m is not None else "no length"
    rfid = body.rfid_sticker_uid or "none"
    rfid_mode = f" ({body.rfid_sim_mode})" if body.rfid_sim_mode else ""
    return LogLine(
        "POLE",
        "INFO",
        f"{gate} {body.direction}: vehicle crossed both lines. Plate {body.plate_read or 'none'} · FASTag {tag_txt} · "
        f"GB-RFID {rfid}{rfid_mode} · radar {length}",
        {
            "plate_read": body.plate_read,
            "fastag_read": body.fastag_read,
            "radar_length_m": body.radar_length_m,
            "rfid_sticker_uid": body.rfid_sticker_uid,
            "rfid_sim_mode": body.rfid_sim_mode,
        },
    )


@router.post("/gates/{gate}/events", response_model=MovementExtendedOut, status_code=201)
def gate_event(gate: str, body: GateEventExtendedIn, db: Session = Depends(get_db)):
    """A vehicle crossed a gate. Run Identify and GB Trip Authorization, store movement and log lines."""
    gate = gate.upper()
    reading = Reading(body.plate_read, body.fastag_read, body.radar_length_m)
    try:
        decision = identify(db, reading, mode=settings.identify_mode)
    except ValueError as exc:
        raise HTTPException(500, str(exc)) from exc

    movement = Movement(
        gate=gate,
        direction=body.direction,
        observed_at=body.observed_at or datetime.now(timezone.utc),
        plate_read=body.plate_read,
        plate_normalised=decision.plate_normalised,
        fastag_read=body.fastag_read,
        radar_length_m=body.radar_length_m,
        result=decision.result,
        truck_id=decision.truck.id if decision.truck else None,
        identify_mode=settings.identify_mode,
        checks=[c.as_dict() for c in decision.checks],
        caught_by=decision.caught_by,
        reasons=decision.reasons,
        flags=decision.flags,
        source=body.source,
    )
    db.add(movement)
    db.flush()

    extra_logs: list[LogLine] = []
    trip_checks: list[TripCheckOut] | None = None
    trip_decision: str | None = None
    trip_session: TripSessionOut | None = None
    quota_remaining: int | None = None
    quota_max: int | None = None

    if body.direction == "IN":
        # Run GB Trip Authorization
        trip_auth = evaluate_entry_authorization(
            db=db,
            identify_decision=decision,
            sticker_uid=body.rfid_sticker_uid,
            sim_auth_mode=body.rfid_sim_mode or "genuine",
        )
        trip_checks = [TripCheckOut(name=c.name, status=c.status, detail=c.detail) for c in trip_auth.checks]
        trip_decision = trip_auth.decision

        if trip_auth.quota:
            quota_remaining = trip_auth.quota.remaining_trips
            quota_max = trip_auth.quota.max_trips

        # Log trip checks
        for c in trip_auth.checks:
            lvl = "INFO" if c.status == "passed" else ("WARN" if c.status == "warning" else "ALERT")
            extra_logs.append(LogLine("PASS", lvl, f"Trip check {c.name}: {c.status}. {c.detail}"))

        if trip_auth.passed and decision.truck and trip_auth.auth_result.sticker:
            session_obj = create_trip_session(
                db=db,
                truck=decision.truck,
                sticker=trip_auth.auth_result.sticker,
                entry_gate=gate,
                entry_movement=movement,
            )
            trip_session = session_obj
            extra_logs.append(
                LogLine(
                    "ACT",
                    "INFO",
                    f"Decision: {trip_decision}. Internal trip token signed and issued ({session_obj.trip_code}).",
                    {"decision": trip_decision, "trip_code": session_obj.trip_code},
                )
            )
        else:
            extra_logs.append(
                LogLine(
                    "ACT",
                    "ALERT" if "REJECTED" in trip_decision else "WARN",
                    f"Decision: {trip_decision}. Reasons: {'; '.join(trip_auth.reasons) or 'Requirements not met'}",
                    {"decision": trip_decision, "reasons": trip_auth.reasons},
                )
            )

    elif body.direction == "OUT":
        # Run Exit verification
        exit_res = verify_and_complete_exit(
            db=db,
            gate=gate,
            truck_plate=body.plate_read,
            sticker_uid=body.rfid_sticker_uid,
            qr_token=body.qr_token,
            sim_auth_mode=body.rfid_sim_mode or "genuine",
            source=body.source,
        )
        trip_checks = [TripCheckOut(name=c.name, status=c.status, detail=c.detail) for c in exit_res.checks]
        trip_decision = exit_res.decision
        trip_session = exit_res.session
        quota_remaining = exit_res.quota_after
        if exit_res.session and exit_res.session.truck:
            # We can look up quota max
            from app.models.trip import VehicleQuota
            q = db.scalar(select(VehicleQuota).where(VehicleQuota.truck_id == exit_res.session.truck_id))
            if q:
                quota_max = q.max_trips

        for c in exit_res.checks:
            lvl = "INFO" if c.status == "passed" else "ALERT"
            extra_logs.append(LogLine("PASS", lvl, f"Exit check {c.name}: {c.status}. {c.detail}"))

        extra_logs.append(
            LogLine(
                "ACT",
                "INFO" if exit_res.passed else "ALERT",
                f"Exit Decision: {trip_decision}",
                {"decision": trip_decision, "passed": exit_res.passed},
            )
        )

    # Save log lines
    all_logs = [_pole_line(gate, body), *describe(decision), *extra_logs]
    rows = logbus.save(db, all_logs, source=body.source, movement_id=movement.id)
    db.commit()
    db.refresh(movement)
    logbus.publish(rows)

    # Attach dynamic properties to response
    movement.rfid_sticker_uid = body.rfid_sticker_uid
    movement.trip_checks = trip_checks
    movement.trip_decision = trip_decision
    movement.trip_session = trip_session
    movement.quota_remaining = quota_remaining
    movement.quota_max = quota_max

    return movement


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    result: str | None = None,
    gate: str | None = None,
    source_prefix: str | None = Query(None, description="e.g. 'sim:12:' for one simulator run"),
    origin: Literal["pole", "sim", "walkthrough"] | None = Query(
        None, description="pole = real poles only, sim = simulator runs, walkthrough = gate console"
    ),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Movement).order_by(Movement.id.desc()).limit(limit)
    if origin == "sim":
        stmt = stmt.where(Movement.source.startswith(SIM_PREFIX))
    elif origin == "walkthrough":
        stmt = stmt.where(Movement.source.startswith(WALKTHROUGH_PREFIX))
    elif origin == "pole":
        stmt = stmt.where(
            or_(
                Movement.source.is_(None),
                and_(~Movement.source.startswith(SIM_PREFIX), ~Movement.source.startswith(WALKTHROUGH_PREFIX)),
            )
        )
    if result:
        stmt = stmt.where(Movement.result == result)
    if gate:
        stmt = stmt.where(Movement.gate == gate.upper())
    if source_prefix:
        stmt = stmt.where(Movement.source.startswith(source_prefix))
    return db.scalars(stmt).all()
