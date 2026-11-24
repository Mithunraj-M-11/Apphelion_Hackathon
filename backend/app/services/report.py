"""GB period report for one permit: what the GB itself recorded over the period, put together for the officers who act
on it. Only the GB's own records are used (gate events, passes, alerts, holds, the Vendor's reports, surveys, officer
actions). Simulation ground truth is never read here: in a real deployment it does not exist."""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Alert, Movement, Officer, Permit, Survey, TripSession, Truck, TruckHold, VendorReport
from app.models.integrity import RecordEntry
from app.models.trip import UNRESOLVED_STATUSES
from app.services import trip

IST = timezone(timedelta(hours=5, minutes=30))

EQUIPMENT = ("POLE_SILENT", "LATE_EVENT", "FAKE_GATE_EVENT", "WEIGH_DRIFT", "LOAD_DROP", "WIM_PAD_DISAGREE",
             "WIM_UNAVAILABLE")
OFFICER = ("OFFICER_EXIT", "OFFICER_LATE_CLOSE", "LATE_CLOSE_UNSUPPORTED", "OFFICER_OVERRIDE_PATTERN")
SURVEY = ("VOLUME_MISMATCH", "VOLUME_TREND", "VOLUME_CUMULATIVE", "EXTRACTION_OUTSIDE_PLAN")
# open items an officer must look at, most serious first
ACTION_CODES = ("RECORD_TAMPERED", "FAKE_GATE_EVENT", "LATE_CLOSE_UNSUPPORTED", "OFFICER_OVERRIDE_PATTERN",
                "VOLUME_CUMULATIVE", "VOLUME_MISMATCH", "VOLUME_TREND", "EXTRACTION_OUTSIDE_PLAN", "WEIGH_DRIFT",
                "WIM_PAD_DISAGREE", "LOAD_DROP", "BODY_MISMATCH", "RFID_CLONED", "CLONE_SUSPECT")
SEV_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}


def _when(a: Alert, observed: dict[int, datetime]) -> str | None:
    """Site time of an alert: the gate event's own time when it has one (alerts without a gate event, e.g. a survey
    or a Vendor report, name their day in the message)."""
    at = observed.get(a.movement_id) if a.movement_id else None
    return at.astimezone(IST).strftime("%d %b %H:%M") if at else None


def _row(a: Alert, observed: dict[int, datetime], officers: dict[int, str]) -> dict:
    return {"code": a.code, "severity": a.severity, "message": a.message, "status": a.status, "when": _when(a, observed),
            "officer": officers.get(a.officer_id) if a.officer_id and a.code in OFFICER else None}


def build(db: Session, permit: Permit) -> dict:
    ledger = trip.ledger(db, permit)
    daily = trip.daily_ledger(db, permit)
    alerts = db.scalars(select(Alert).where(Alert.permit_id == permit.id).order_by(Alert.id)).all()
    move_ids = {a.movement_id for a in alerts if a.movement_id}
    observed = dict(db.execute(select(Movement.id, Movement.observed_at).where(Movement.id.in_(move_ids))).all()) \
        if move_ids else {}
    officers = dict(db.execute(select(Officer.id, Officer.name)).all())

    # ---- the Vendor's claims against the GB's own count, day by day
    vendor = {v.day.isoformat(): v for v in db.scalars(select(VendorReport).where(VendorReport.permit_id == permit.id))}
    for d in daily:
        v = vendor.get(d["day"])
        d["vendor_trips"] = v.trips if v else None
        d["vendor_tonnes"] = round(v.tonnes, 2) if v else None
    reported_days = [d for d in daily if d["vendor_trips"] is not None]
    vendor_totals = {
        "days_reported": len(reported_days),
        "trips": sum(d["vendor_trips"] for d in reported_days),
        "tonnes": round(sum(d["vendor_tonnes"] for d in reported_days), 2),
        "gb_trips_same_days": sum(d["actual_trips"] for d in reported_days),
        "gb_tonnes_same_days": round(sum(d["tonnes"] for d in reported_days), 2),
        "days_under_reported": len({a.message.split(":")[0] for a in alerts if a.code.startswith("UNDER_REPORT")}),
    }

    # ---- trips without a pass: forced barriers, tonnes estimated from the exit weight minus the enrolled empty weight
    illegal = db.execute(select(Movement.weight_t, Truck.empty_weight_t).outerjoin(Truck, Truck.id == Movement.truck_id)
                         .where(Movement.permit_id == permit.id, Movement.trip == "ILLEGAL")).all()
    illegal_t = round(sum(max(0.0, w - e) for w, e in illegal if w is not None and e is not None), 2)
    late_charged = db.scalar(select(func.count()).select_from(TripSession).where(
        TripSession.permit_id == permit.id, TripSession.notes.like("%charged at the rated%"))) or 0

    # ---- weekly surveys (mass balance)
    surveys = db.scalars(select(Survey).where(Survey.permit_id == permit.id).order_by(Survey.period_from)).all()
    accepted = [s for s in surveys if s.status == "accepted" and s.surveyed_out_t is not None]
    survey_rows = [{"period_from": s.period_from.isoformat(), "period_to": s.period_to.isoformat(), "method": s.method,
                    "status": s.status, "surveyed_out_t": s.surveyed_out_t, "gates_out_t": s.gates_out_t,
                    "gap_pct": s.gap_pct} for s in surveys]
    survey_total = None
    if accepted:
        out, gates = sum(s.surveyed_out_t for s in accepted), sum(s.gates_out_t or 0 for s in accepted)
        survey_total = {"surveyed_out_t": round(out, 1), "gates_out_t": round(gates, 1), "gap_t": round(out - gates, 1),
                        "gap_pct": round((out - gates) / gates * 100, 1) if gates else None}
    survey_codes = sorted({a.code for a in alerts if a.code in SURVEY})

    # ---- equipment and officers
    equipment = [_row(a, observed, officers) for a in alerts if a.code in EQUIPMENT]
    outages = [a for a in alerts if a.code == "POLE_SILENT"]
    outage_min = 0
    for a in outages:
        try:
            outage_min += int(a.message.split("silent for ")[1].split(" min")[0])
        except (IndexError, ValueError):
            pass
    by_officer: dict[str, Counter] = defaultdict(Counter)
    for a in alerts:
        if a.code in OFFICER and a.officer_id:
            by_officer[officers.get(a.officer_id, f"officer {a.officer_id}")][a.code] += 1
    officer_rows = [{"officer": name, **{c: n for c, n in counts.items()}, "total": sum(
        n for c, n in counts.items() if c in ("OFFICER_EXIT", "OFFICER_LATE_CLOSE"))}
                    for name, counts in sorted(by_officer.items())]

    # ---- record integrity: the chain and any check that failed
    chained = db.scalar(select(func.count()).select_from(RecordEntry).where(RecordEntry.permit_id == permit.id)) or 0
    tampered = [_row(a, observed, officers) for a in alerts if a.code == "RECORD_TAMPERED"]

    # ---- what needs an officer now
    unresolved = db.execute(select(TripSession.trip_code, TripSession.status, TripSession.expires_at, Truck.plate)
                            .join(Truck, Truck.id == TripSession.truck_id)
                            .where(TripSession.permit_id == permit.id, TripSession.status.in_(UNRESOLVED_STATUSES))
                            .order_by(TripSession.expires_at)).all()
    holds = db.execute(select(TruckHold.reason_code, TruckHold.created_at, Truck.plate)
                       .join(Truck, Truck.id == TruckHold.truck_id)
                       .where(TruckHold.permit_id == permit.id, TruckHold.released_at.is_(None))).all()
    open_alerts = sorted([a for a in alerts if a.status == "open" and a.code in ACTION_CODES],
                         key=lambda a: (SEV_RANK.get(a.severity, 9), ACTION_CODES.index(a.code), a.id))
    action_counts = Counter(a.code for a in open_alerts)
    seen, action_rows = set(), []
    for a in open_alerts:  # one example per code, with how many there are
        if a.code in seen:
            continue
        seen.add(a.code)
        action_rows.append({**_row(a, observed, officers), "count": action_counts[a.code]})

    # ---- findings in plain words, most serious first
    findings: list[dict] = []
    gb_trips, gb_t = ledger["actual_trips"], ledger["tonnes"] + illegal_t

    def find(severity: str, text: str) -> None:
        findings.append({"severity": severity, "text": text})

    if vendor_totals["days_reported"]:
        miss = vendor_totals["gb_trips_same_days"] - vendor_totals["trips"]
        miss_t = vendor_totals["gb_tonnes_same_days"] + illegal_t - vendor_totals["tonnes"]
        if miss > 0:
            find("HIGH", f"The Vendor reported {vendor_totals['trips']:,} trips and {vendor_totals['tonnes']:,.0f} t; "
                         f"the GB gates counted {vendor_totals['gb_trips_same_days']:,} trips on the same days: "
                         f"{miss:,} trips ({miss / max(1, vendor_totals['gb_trips_same_days']):.0%}) and about "
                         f"{max(0.0, miss_t):,.0f} t not reported.")
        else:
            find("INFO", "The Vendor's reports match or exceed what the GB gates counted.")
    if survey_total and survey_total["gap_t"] > 0 and survey_codes:
        find("HIGH", f"Weekly surveys: about {survey_total['gap_t']:,.0f} t more left the site than the GB gates weighed "
                     f"({survey_total['gap_pct']}%): material is leaving by a route without a gate "
                     f"({', '.join(survey_codes)}).")
    elif survey_total:
        find("INFO", f"Weekly surveys agree with the gates within tolerance (gap {survey_total['gap_pct']}%).")
    if ledger["illegal_trips"]:
        find("CRITICAL", f"{ledger['illegal_trips']} trucks broke through an exit barrier without a pass (illegal trips, "
                         f"about {illegal_t:,.0f} t).")
    unsupported = sum(1 for a in alerts if a.code == "LATE_CLOSE_UNSUPPORTED")
    if unsupported:
        find("HIGH", f"{unsupported} officer late closes had no equipment fault on record to explain them "
                     f"(LATE_CLOSE_UNSUPPORTED); {late_charged} late-closed trips were charged at the truck's rated load.")
    if any(a.code == "OFFICER_OVERRIDE_PATTERN" for a in alerts):
        find("HIGH", "One officer made repeated overrides in a day (OFFICER_OVERRIDE_PATTERN).")
    if tampered:
        find("CRITICAL", f"The record check found edited or deleted gate events ({len(tampered)} failed checks).")
    if outages:
        find("MEDIUM", f"GB poles were silent {len(outages)} times, about {outage_min} minutes in all: anything that moved "
                       "then is unrecorded.")
    pad = [a for a in alerts if a.code in ("WEIGH_DRIFT", "WIM_PAD_DISAGREE", "LOAD_DROP")]
    if pad:
        find("HIGH", f"The weigh pad was questioned {len(pad)} times (reference test, drift, WIM disagreeing, loads "
                     "dropping): its readings in that period may be low.")
    trips_pct = gb_trips / permit.trip_limit if permit.trip_limit else 0
    tonne_pct = gb_t / permit.tonne_limit if permit.tonne_limit else 0
    find("CRITICAL" if max(trips_pct, tonne_pct) > 1 else "INFO",
         f"Permit use: {gb_trips:,} of {permit.trip_limit:,} trips counted at the gates ({trips_pct:.0%}), "
         f"{gb_t:,.0f} of {permit.tonne_limit:,.0f} t ({tonne_pct:.0%}).")
    findings.sort(key=lambda f: SEV_RANK.get(f["severity"], 9))

    return {
        "permit": {"id": permit.id, "label": permit.label, "valid_from": permit.valid_from.isoformat(),
                   "valid_to": permit.valid_to.isoformat(), "trip_limit": permit.trip_limit,
                   "tonne_limit": permit.tonne_limit, "vehicle_limit": permit.vehicle_limit,
                   "hours": f"{permit.hours_start:%H:%M} to {permit.hours_end:%H:%M}"},
        "generated_at": datetime.now(IST).strftime("%d %b %Y %H:%M"),
        "period": {"from": daily[0]["day"] if daily else permit.valid_from.isoformat(),
                   "to": daily[-1]["day"] if daily else permit.valid_to.isoformat(), "days": len(daily)},
        "totals": {"trips_with_pass": ledger["legal_trips"], "trips_counted": gb_trips,
                   "trips_without_pass": ledger["illegal_trips"], "tonnes_with_pass": round(ledger["tonnes"], 2),
                   "tonnes_without_pass_est": illegal_t, "tonnes_counted": round(gb_t, 2),
                   "vehicles": ledger["vehicles"], "open_passes": ledger["open_passes"],
                   "unresolved_passes": ledger.get("unresolved_passes", 0), "late_closes_charged": late_charged},
        "vendor": vendor_totals,
        "findings": findings,
        "needs_action": {"alerts": action_rows,
                         "unresolved": [{"trip_code": c, "status": s, "plate": p,
                                         "expired": e.astimezone(IST).strftime("%d %b %H:%M")} for c, s, e, p in unresolved],
                         "holds": [{"plate": p, "reason": r} for r, _, p in holds]},
        "daily": daily,
        "surveys": {"rows": survey_rows, "total": survey_total, "alerts": survey_codes},
        "equipment": {"pole_outages": len(outages), "outage_minutes": outage_min,
                      "counts": dict(Counter(a.code for a in alerts if a.code in EQUIPMENT)), "items": equipment[:40]},
        "officers": officer_rows,
        "integrity": {"chained_events": chained, "failed_checks": tampered},
        "alerts_by_severity": dict(Counter(a.severity for a in alerts)),
        "alerts_by_code": dict(Counter(a.code for a in alerts).most_common()),
    }
