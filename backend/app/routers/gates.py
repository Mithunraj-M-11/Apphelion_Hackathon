"""Gate pole API: poles (real or simulated) post what they observe; the GB server decides.

One pipeline for every gate event (and for the officer's exit verification): Identify (plate + FASTag + length +
GB RFID sticker), then the entry or exit trip pipeline in services/trip.py.
"""

import json
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import acting_officer
from app.models import Movement, Officer, Permit
from app.schemas import (GateDecisionOut, GateEventIn, MovementOut, OfficerActionIn, PassFull, PassSummary,
                         TripCheckOut, TripSessionOut)
from app.services import cleanup, integrity, logbus, trip
from app.services.identify import Reading, describe, identify
from app.services.logbus import LogLine

router = APIRouter(prefix="/api", tags=["gates"])

SIM_PREFIX = "sim:"
WALKTHROUGH_PREFIX = "walkthrough:"
SITE_PREFIX = "site:"


def _pole_line(gate: str, body: GateEventIn) -> LogLine:
    tag = body.fastag_read
    tag_txt = f"{tag[:8]}…{tag[-4:]}" if tag and len(tag) > 12 else (tag or "none")
    length = f"{body.radar_length_m:.2f} m" if body.radar_length_m is not None else "no length"
    weight = f"{body.weight_t:.2f} t" if body.weight_t is not None else "no weight"
    rfid = body.rfid_sticker_uid or "none"
    rfid_mode = f" ({body.rfid_sim_mode})" if body.rfid_sticker_uid and body.rfid_sim_mode not in (None, "genuine") else ""
    shown = " · QR shown" if (body.pass_token or body.qr_token) else " · SMS code given" if body.pass_code else ""
    forced = " · BARRIER IMPACT" if body.barrier_forced else ""
    return LogLine(
        "POLE", "INFO",
        f"{gate} {body.direction}: vehicle at the barrier. Plate {body.plate_read or 'none'} · FASTag {tag_txt} · "
        f"GB sticker {rfid}{rfid_mode} · radar {length} · weigh pad {weight}{shown}{forced}",
        {"plate_read": body.plate_read, "fastag_read": body.fastag_read, "radar_length_m": body.radar_length_m,
         "weight_t": body.weight_t, "rfid_sticker_uid": body.rfid_sticker_uid, "rfid_sim_mode": body.rfid_sim_mode},
    )


def resolve_permit(db: Session, permit_id: int | None) -> Permit:
    """The permit this gate event counts against. A real pole's gate is configured to its contract's permit; in
    the PoC the simulator and Gate console pass their own permit_id, otherwise the latest real permit is used."""
    if permit_id is not None:
        permit = db.get(Permit, permit_id)
        if permit is None:
            raise HTTPException(404, f"Permit {permit_id} not found")
        return permit
    permit = db.scalar(select(Permit).where(Permit.source.is_(None)).order_by(Permit.id.desc()))
    if permit is None:
        raise HTTPException(409, "No permit configured")
    return permit


def process_gate_event(db: Session, gate: str, body: GateEventIn) -> GateDecisionOut:
    """Identify the vehicle, run the entry or exit pipeline, store movement + alerts + log lines, stream the logs."""
    gate = gate.upper()
    permit = resolve_permit(db, body.permit_id)
    observed = body.observed_at or datetime.now(timezone.utc)
    reading = Reading(body.plate_read, body.fastag_read, body.radar_length_m)
    try:
        decision = identify(db, reading, mode=settings.identify_mode)
    except ValueError as exc:
        raise HTTPException(500, str(exc)) from exc
    trip.sweep_expired(db, permit, observed)  # P10 at the pole's event time
    movement = Movement(
        gate=gate,
        direction=body.direction,
        observed_at=observed,
        plate_read=body.plate_read,
        plate_normalised=decision.plate_normalised,
        fastag_read=body.fastag_read,
        radar_length_m=body.radar_length_m,
        rfid_sticker_uid=body.rfid_sticker_uid,
        result=decision.result,
        truck_id=decision.truck.id if decision.truck else None,
        identify_mode=settings.identify_mode,
        checks=[c.as_dict() for c in decision.checks],
        caught_by=decision.caught_by,
        reasons=decision.reasons,
        flags=decision.flags,
        source=body.source,
        permit_id=permit.id,
        weight_t=body.weight_t,
        barrier_forced=body.barrier_forced,
    )
    db.add(movement)
    db.flush()
    t = trip.Trip(db, permit, movement, decision, decision.involved, pass_token=body.pass_token or body.qr_token,
                  pass_code=body.pass_code, sticker_uid=body.rfid_sticker_uid,
                  rfid_mode=body.rfid_sim_mode or "genuine")
    trip.process(t)
    # the pole was heard: judge its silence before this event, and whether this event arrived late (gaps 2, 3)
    for a in integrity.signal(db, permit, gate, observed, body.source, heartbeat=False, movement_id=movement.id):
        t.alerts.append(a)
        t.log("ACT", trip.LEVEL[a.severity], f"{a.severity} {a.code}: {a.message}", {"alert": a.code})
    db.flush()
    integrity.chain_append(db, movement)  # Record: hash chain (gap 5)
    rows = logbus.save(db, [_pole_line(gate, body), *describe(decision), *t.lines], source=body.source,
                       movement_id=movement.id)
    db.commit()
    db.refresh(movement)
    logbus.publish(rows)
    return _decision_out(db, movement, t)


def _decision_out(db: Session, movement: Movement, t: trip.Trip) -> GateDecisionOut:
    out = GateDecisionOut.model_validate(movement)
    out.trip_checks = [TripCheckOut(**c) for c in t.trip_checks()]
    out.trip_decision = t.trip_decision
    if t.session is not None:
        db.refresh(t.session)
        out.trip_session = TripSessionOut.model_validate(t.session)
    if t.quota is not None:
        out.quota_remaining, out.quota_max = t.quota.remaining_trips, t.quota.max_trips
    if t.issued is not None:
        s = t.issued
        out.issued_pass = PassFull.model_validate({**PassSummary.model_validate(s).model_dump(), "token": s.token,
                                                   "sms_code": s.sms_code, "plate": s.truck.plate})
    return out


def _refuse_unsigned(db: Session, gate: str, raw: bytes, body: GateEventIn, signature: str | None) -> None:
    permit = resolve_permit(db, body.permit_id)
    a = integrity.report_fake(db, permit, gate, json.loads(raw), signature)
    rows = logbus.save(db, [LogLine("ACT", "CRITICAL", f"CRITICAL FAKE_GATE_EVENT: {a.message}")], source=body.source)
    db.commit()
    logbus.publish(rows)


@router.post("/gates/{gate}/events", response_model=GateDecisionOut, status_code=201)
async def gate_event(gate: str, request: Request, db: Session = Depends(get_db)):
    """A vehicle arrived at a gate barrier: identify it (plate + FASTag + length + GB RFID sticker), then run the
    entry or exit pipeline (pass, weight, quota, barrier). Only events signed by a GB pole (X-Pole-Signature:
    HMAC-SHA256 of the body with the pole's key) are accepted; anything else is refused and reported (gap 4)."""
    raw = await request.body()
    try:
        body = GateEventIn.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False)) from exc
    signature = request.headers.get("X-Pole-Signature")
    if not integrity.signature_ok(gate, raw, signature):
        await run_in_threadpool(_refuse_unsigned, db, gate, raw, body, signature)
        raise HTTPException(401, "Gate event not signed by a GB pole: refused and reported")
    return await run_in_threadpool(process_gate_event, db, gate, body)


@router.post("/console/gates/{gate}/events", response_model=GateDecisionOut, status_code=201)
def console_gate_event(gate: str, body: GateEventIn, db: Session = Depends(get_db)):
    """The Gate console's simulated pole (mocked sensors, run by the GB itself). Accepted without a pole signature,
    but only for Gate console sessions (source walkthrough:), never for a real permit."""
    permit = db.get(Permit, body.permit_id) if body.permit_id is not None else None
    if not (body.source or "").startswith(WALKTHROUGH_PREFIX) or permit is None             or not (permit.source or "").startswith(WALKTHROUGH_PREFIX):
        raise HTTPException(403, "The console pole only posts for Gate console sessions, under their own permit")
    return process_gate_event(db, gate, body)


class HeartbeatIn(BaseModel):
    at: datetime  # pole time
    permit_id: int | None = None
    source: str | None = None


def _heartbeat(db: Session, gate: str, hb: HeartbeatIn) -> dict:
    permit = resolve_permit(db, hb.permit_id)
    alerts = integrity.signal(db, permit, gate, hb.at, hb.source, heartbeat=True)
    rows = logbus.save(db, [LogLine("ACT", trip.LEVEL[a.severity], f"{a.severity} {a.code}: {a.message}",
                                    {"alert": a.code}) for a in alerts], source=hb.source)
    db.commit()
    logbus.publish(rows)
    return {"gate": gate.upper(), "at": hb.at.isoformat(), "alerts": [a.code for a in alerts]}


@router.post("/console/poles/{gate}/heartbeat")
def console_heartbeat(gate: str, hb: HeartbeatIn, db: Session = Depends(get_db)) -> dict:
    """The Gate console's simulated pole heartbeat (Gate console permits only), used by the console's
    "pole goes silent" demonstration."""
    permit = db.get(Permit, hb.permit_id) if hb.permit_id is not None else None
    if permit is None or not (permit.source or "").startswith(WALKTHROUGH_PREFIX)             or not (hb.source or "").startswith(WALKTHROUGH_PREFIX):
        raise HTTPException(403, "The console pole only signals for Gate console sessions")
    return _heartbeat(db, gate, hb)


@router.post("/poles/{gate}/heartbeat")
async def pole_heartbeat(gate: str, request: Request, db: Session = Depends(get_db)):
    """A pole's 'I'm alive' signal (every few minutes). A silence longer than the allowed gap raises POLE_SILENT when
    the pole is heard again (gap 2). Signed like gate events, so nobody can fake a pole being alive."""
    raw = await request.body()
    if not integrity.signature_ok(gate, raw, request.headers.get("X-Pole-Signature")):
        raise HTTPException(401, "Heartbeat not signed by a GB pole")
    try:
        hb = HeartbeatIn.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False)) from exc
    return await run_in_threadpool(_heartbeat, db, gate, hb)


@router.post("/movements/{movement_id}/officer-exit", response_model=GateDecisionOut, status_code=201)
def officer_exit(movement_id: int, body: OfficerActionIn, db: Session = Depends(get_db),
                 officer: Officer = Depends(acting_officer)):
    """An officer lets out a truck whose exit was refused (lost QR, expired pass, sticker unreadable): the truck's
    own pass is closed by the officer and flagged; the trip counts. Refused while the truck is on hold."""
    refused = db.get(Movement, movement_id)
    if refused is None:
        raise HTTPException(404, "Movement not found")
    try:
        t = trip.officer_exit(db, refused, officer, body.reason, body.observed_at or datetime.now(timezone.utc))
    except trip.OfficerActionError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.flush()
    rows = logbus.save(db, [LogLine("ACT", "WARN", f"{refused.gate} exit: officer {officer.name} lets "
                                                   f"{t.decision.truck.plate} out after a refused exit: {body.reason}"),
                            *t.lines], source=refused.source, movement_id=t.movement.id)
    integrity.chain_append(db, t.movement)
    db.commit()
    db.refresh(t.movement)
    logbus.publish(rows)
    return _decision_out(db, t.movement, t)


class ReferenceTestIn(BaseModel):
    known_weight_t: float  # the reference load's certified weight
    pad_reading_t: float  # what the GB weigh pad showed for it
    observed_at: datetime | None = None
    permit_id: int | None = None


@router.post("/gates/{gate}/reference-test")
def gate_reference_test(gate: str, body: ReferenceTestIn, db: Session = Depends(get_db),
                        officer: Officer = Depends(acting_officer)) -> dict:
    """Gap 1B: an officer runs the GB's reference load over the weigh pad (random, unannounced). Off by more than
    0.3 t = WEIGH_DRIFT."""
    permit = resolve_permit(db, body.permit_id)
    at = body.observed_at or datetime.now(timezone.utc)
    a = trip.reference_test(db, permit, gate.upper(), body.known_weight_t, body.pad_reading_t, at, officer)
    ok = a is None
    rows = logbus.save(db, [LogLine("MEASURE", "INFO" if ok else "ALERT",
                                    f"Reference weight test at {gate.upper()} by {officer.name}: {body.known_weight_t:.2f} t "
                                    f"load read {body.pad_reading_t:.2f} t" + ("" if ok else f". HIGH WEIGH_DRIFT"))],
                       source=permit.source)
    db.commit()
    logbus.publish(rows)
    return {"gate": gate.upper(), "passed": ok, "difference_t": round(body.pad_reading_t - body.known_weight_t, 2),
            "alerts": [] if ok else ["WEIGH_DRIFT"]}


@router.delete("/walkthrough-history")
def clear_walkthrough_history(db: Session = Depends(get_db)):
    """Gate console only: delete every Gate console session (its permits, gate events, passes, holds, alerts and
    log lines) so a demo starts from a clean slate. Real gate data, scenario runs and site runs are not touched."""
    counts = cleanup.clear_source(db, WALKTHROUGH_PREFIX)
    db.commit()
    return counts


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    result: str | None = None,
    gate: str | None = None,
    source_prefix: str | None = Query(None, description="e.g. 'sim:12:' for one simulator run"),
    permit_id: int | None = None,
    origin: Literal["pole", "sim", "walkthrough", "site"] | None = Query(
        None, description="pole = real poles only, sim = simulator runs, walkthrough = gate console, site = site runs"
    ),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Movement).order_by(Movement.id.desc()).limit(limit)
    if origin == "sim":
        stmt = stmt.where(Movement.source.startswith(SIM_PREFIX))
    elif origin == "walkthrough":
        stmt = stmt.where(Movement.source.startswith(WALKTHROUGH_PREFIX))
    elif origin == "site":
        stmt = stmt.where(Movement.source.startswith(SITE_PREFIX))
    elif origin == "pole":
        stmt = stmt.where(
            or_(
                Movement.source.is_(None),
                and_(~Movement.source.startswith(SIM_PREFIX), ~Movement.source.startswith(WALKTHROUGH_PREFIX),
                     ~Movement.source.startswith(SITE_PREFIX)),
            )
        )
    if result:
        stmt = stmt.where(Movement.result == result)
    if gate:
        stmt = stmt.where(Movement.gate == gate.upper())
    if source_prefix:
        stmt = stmt.where(Movement.source.startswith(source_prefix))
    if permit_id is not None:
        stmt = stmt.where(Movement.permit_id == permit_id)
    return db.scalars(stmt).all()
