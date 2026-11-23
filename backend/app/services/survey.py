"""Mass balance (gap 7): side tracks, light vehicles and digging outside the plan never pass a gate, so the GB checks
the ground itself. Weekly survey, ore that left by the survey vs ore weighed out through the GB's gates:

  VOLUME_MISMATCH          gap above MISMATCH_PCT in one survey (single-survey error is about +/-3%)
  VOLUME_TREND             gap above TREND_PCT in TREND_RUNS surveys in a row: survey error is random, leakage always
                           pushes the same way, so a steady small gap is leakage too
  VOLUME_CUMULATIVE        since the first survey, ore that left (sum of the weekly volumes) exceeds what the gates
                           weighed by more than MISMATCH_PCT of an average week. Weekly volumes are differences of
                           terrain models, so the middle models cancel: the error since the start stays about one
                           week's error in tonnes while the volume grows, and steady leakage piles up above it
  EXTRACTION_OUTSIDE_PLAN  the survey shows digging outside the approved boundary or depth
A survey whose check-pillar error is above MAX_CHECK_ERROR_CM is rejected (flown again), so the +/-3% stays honest.
"""

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Alert, Movement, Permit, TripSession, Truck
from app.models.survey import Survey
from app.services.trip import DONE, IST

MISMATCH_PCT = 5.0
TREND_PCT, TREND_RUNS = 2.0, 3
MAX_CHECK_ERROR_CM = 5.0


def gates_out_t(db: Session, permit: Permit, d_from: date, d_to: date) -> float:
    """Ore the GB's gates saw leave in the period: net tonnes of closed passes, plus barrier-breaking trips estimated
    from the weigh pad minus the truck's enrolled empty weight (12 t for unknown trucks)."""
    start = datetime.combine(d_from, time(0, 0), tzinfo=IST)
    end = datetime.combine(d_to + timedelta(days=1), time(0, 0), tzinfo=IST)
    legal = db.scalar(select(func.coalesce(func.sum(TripSession.net_t), 0.0)).where(
        TripSession.permit_id == permit.id, TripSession.status == DONE, TripSession.completed_at >= start,
        TripSession.completed_at < end)) or 0.0
    illegal = 0.0
    for w, empty in db.execute(select(Movement.weight_t, Truck.empty_weight_t).outerjoin(Truck, Truck.id == Movement.truck_id)
                               .where(Movement.permit_id == permit.id, Movement.trip == "ILLEGAL",
                                      Movement.weight_t.is_not(None), Movement.observed_at >= start,
                                      Movement.observed_at < end)).all():
        illegal += max(0.0, w - (empty or 12.0))
    return round(float(legal) + illegal, 2)


def record(db: Session, permit: Permit, *, period_from: date, period_to: date, method: str, volume_dug_m3: float,
           density_t_m3: float, stockpile_change_t: float = 0.0, outside_plan_m3: float = 0.0,
           check_error_cm: float | None = None, officer_id: int | None = None) -> tuple[Survey, list[Alert]]:
    s = Survey(permit_id=permit.id, period_from=period_from, period_to=period_to, method=method,
               volume_dug_m3=volume_dug_m3, density_t_m3=density_t_m3, stockpile_change_t=stockpile_change_t,
               outside_plan_m3=outside_plan_m3, check_error_cm=check_error_cm, officer_id=officer_id,
               source=permit.source)
    alerts: list[Alert] = []
    if check_error_cm is not None and check_error_cm > MAX_CHECK_ERROR_CM:
        s.status = "rejected"
        db.add(s)
        return s, alerts
    s.status = "accepted"
    s.surveyed_out_t = round(volume_dug_m3 * density_t_m3 - stockpile_change_t, 2)
    s.gates_out_t = gates_out_t(db, permit, period_from, period_to)
    s.gap_pct = round(100 * (s.surveyed_out_t - s.gates_out_t) / s.gates_out_t, 2) if s.gates_out_t else None
    db.add(s)
    db.flush()
    period = f"{period_from:%d %b} to {period_to:%d %b}"

    def alert(code: str, severity: str, message: str) -> None:
        a = Alert(permit_id=permit.id, code=code, severity=severity, message=message, status="open",
                  source=permit.source, officer_id=officer_id)
        db.add(a)
        alerts.append(a)

    if s.gap_pct is not None and s.gap_pct > MISMATCH_PCT:
        alert("VOLUME_MISMATCH", "HIGH",
              f"Survey {period}: {s.surveyed_out_t:,.0f} t of ore left the site, the GB's gates weighed "
              f"{s.gates_out_t:,.0f} t ({s.gap_pct:+.1f}%, tolerance {MISMATCH_PCT:g}%). Material left by another way "
              "(side tracks, unrecorded vehicles) or the gate weights are wrong")
    recent = db.scalars(select(Survey).where(Survey.permit_id == permit.id, Survey.status == "accepted")
                        .order_by(Survey.period_to.desc(), Survey.id.desc()).limit(TREND_RUNS)).all()
    if len(recent) == TREND_RUNS and all(x.gap_pct is not None and x.gap_pct > TREND_PCT for x in recent) \
            and not (s.gap_pct is not None and s.gap_pct > MISMATCH_PCT):
        gaps = ", ".join(f"{x.gap_pct:+.1f}%" for x in reversed(recent))
        alert("VOLUME_TREND", "HIGH",
              f"The survey has shown more ore leaving than the gates weighed {TREND_RUNS} times in a row ({gaps}). "
              "Survey error goes both ways; a gap that always points the same way is steady leakage")
    accepted = db.scalars(select(Survey).where(Survey.permit_id == permit.id, Survey.status == "accepted",
                                               Survey.gates_out_t.is_not(None))).all()
    if len(accepted) >= 2 and not (s.gap_pct is not None and s.gap_pct > MISMATCH_PCT):
        cum_survey = sum(x.surveyed_out_t for x in accepted)
        cum_gates = sum(x.gates_out_t for x in accepted)
        threshold = MISMATCH_PCT / 100 * cum_gates / len(accepted)
        already = db.scalar(select(func.count()).select_from(Alert).where(Alert.permit_id == permit.id,
                                                                         Alert.code == "VOLUME_CUMULATIVE")) or 0
        if cum_survey - cum_gates > threshold and not already:
            alert("VOLUME_CUMULATIVE", "HIGH",
                  f"Since the first survey ({len(accepted)} weeks): {cum_survey:,.0f} t of ore left the site, the gates "
                  f"weighed {cum_gates:,.0f} t, {cum_survey - cum_gates:,.0f} t more ({100 * (cum_survey - cum_gates) / cum_gates:+.1f}%). "
                  f"Survey error stays about {threshold:,.0f} t however long the period; steady leakage keeps growing")
    if outside_plan_m3 > 0:
        alert("EXTRACTION_OUTSIDE_PLAN", "CRITICAL",
              f"Survey {period}: {outside_plan_m3:,.0f} m3 dug outside the approved boundary or depth "
              f"(about {outside_plan_m3 * density_t_m3:,.0f} t)")
    return s, alerts
