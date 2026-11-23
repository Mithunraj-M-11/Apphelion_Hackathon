"""Weigh-in-Motion (WIM) router: device management, simulation, verification, and anomaly workflows."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import acting_officer
from app.models import Movement, Officer, Truck
from app.models.wim import WimAnomaly, WimDevice, WimMeasurement
from app.schemas import (
    WimAnomalyOut,
    WimAnomalyReviewIn,
    WimCorrelationOut,
    WimDashboardMetricsOut,
    WimDeviceOut,
    WimDeviceStatusUpdate,
    WimMeasurementIn,
    WimMeasurementOut,
    WimMeasurementSimulateIn,
    WimVerificationCheck,
)
from app.services import wim_service
from app.services.wim_simulator import generate_simulated_wim

router = APIRouter(prefix="/api/wim", tags=["wim"])


@router.get("/devices", response_model=list[WimDeviceOut])
def list_devices(db: Session = Depends(get_db)):
    """List all simulated GB WIM devices and their current operational status."""
    return wim_service.ensure_default_devices(db)


@router.patch("/devices/{device_code}/status", response_model=WimDeviceOut)
def update_device_status(
    device_code: str,
    body: WimDeviceStatusUpdate,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Simulate WIM device availability transition (ONLINE, OFFLINE, DEGRADED) with officer attribution."""
    try:
        return wim_service.set_device_status(
            db, device_code, body.status, officer=officer, reason=body.reason
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/simulate", response_model=WimCorrelationOut)
def simulate_wim_measurement(
    body: WimMeasurementSimulateIn,
    db: Session = Depends(get_db),
):
    """Generate a realistic simulated WIM measurement and correlate with radar observation."""
    wim_service.ensure_default_devices(db)
    dev_code = body.device_code or f"WIM-{body.gate.upper()}-01"
    dev = wim_service.get_wim_device(db, dev_code)

    # Force device status if requested in simulator
    if body.force_device_status:
        dev = wim_service.set_device_status(db, dev_code, body.force_device_status)

    is_offline = dev.status == "OFFLINE" if dev else False

    # Look up truck if plate or movement given
    truck = None
    plate = body.plate
    radar_length = body.radar_length_m
    movement = None

    if body.movement_id:
        movement = db.get(Movement, body.movement_id)
        if movement:
            if not plate:
                plate = movement.plate_read
            if radar_length is None:
                radar_length = movement.radar_length_m
            if movement.truck_id and not truck:
                truck = db.get(Truck, movement.truck_id)

    if plate and not truck:
        truck = db.scalar(select(Truck).where(Truck.plate == plate))

    truck_specs = None
    if truck:
        truck_specs = {
            "axle_count": truck.axle_count,
            "empty_weight_t": truck.empty_weight_t,
            "rated_capacity_t": truck.rated_capacity_t,
            "gvw_t": truck.gvw_t,
        }

    # Generate reading
    sim = generate_simulated_wim(
        scenario=body.scenario,
        gate=body.gate,
        direction=body.direction,
        device_code=dev_code,
        plate=plate,
        speed_kmh=body.speed_kmh,
        custom_axle_weights=body.custom_axle_weights,
        custom_quality=body.quality,
        known_truck_specs=truck_specs,
    )

    if is_offline:
        sim.status = "FAILED"
        sim.quality = "POOR"

    # Store measurement
    measurement = wim_service.record_measurement(
        db=db,
        device_code=sim.device_code,
        gate=sim.gate,
        direction=sim.direction,
        speed_kmh=sim.speed_kmh,
        axle_count=sim.axle_count,
        axle_weights=sim.axle_weights,
        quality=sim.quality,
        status=sim.status,
        plate=plate,
        truck_id=truck.id if truck else None,
        movement_id=body.movement_id,
        radar_length_m=radar_length,
        source=sim.source,
        observed_at=sim.observed_at,
        measurement_id=sim.measurement_id,
        wim_available=not is_offline,
    )

    # Compute correlation
    corr = wim_service.correlate_radar_and_wim(
        radar_length_m=radar_length,
        wim_measurement=measurement,
        truck=truck,
        radar_available=radar_length is not None,
        wim_available=not is_offline,
    )

    db.refresh(measurement)

    return WimCorrelationOut(
        overall_status=corr["overall_status"],
        correlation_status=corr["correlation_status"],
        summary=corr["summary"],
        checks=[WimVerificationCheck(**c) for c in corr["checks"]],
        measurement=WimMeasurementOut.model_validate(measurement),
        discrepancy_reason=corr["discrepancy_reason"],
        monitoring_warning=corr["monitoring_warning"],
    )


@router.post("/measurements", response_model=WimMeasurementOut, status_code=201)
def create_measurement(
    body: WimMeasurementIn,
    db: Session = Depends(get_db),
):
    """Ingest a dynamic WIM measurement."""
    gross = body.gross_weight_t or sum(body.axle_weights)
    m = wim_service.record_measurement(
        db=db,
        device_code=body.device_code,
        gate=body.gate,
        direction=body.direction,
        speed_kmh=body.speed_kmh,
        axle_count=body.axle_count,
        axle_weights=body.axle_weights,
        quality=body.quality,
        status=body.status,
        plate=body.plate,
        truck_id=body.truck_id,
        movement_id=body.movement_id,
        radar_length_m=body.radar_length_m,
        source=body.source,
        observed_at=body.observed_at,
        measurement_id=body.measurement_id,
        lane=body.lane,
    )
    return m


@router.get("/measurements", response_model=list[WimMeasurementOut])
def list_measurements(
    gate: str | None = None,
    direction: str | None = None,
    plate: str | None = None,
    correlation_status: str | None = None,
    quality: str | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Retrieve WIM measurement history with filters."""
    query = select(WimMeasurement).order_by(WimMeasurement.id.desc())
    if gate:
        query = query.where(WimMeasurement.gate == gate.upper())
    if direction:
        query = query.where(WimMeasurement.direction == direction.upper())
    if plate:
        query = query.where(WimMeasurement.plate.ilike(f"%{plate}%"))
    if correlation_status:
        query = query.where(WimMeasurement.correlation_status == correlation_status)
    if quality:
        query = query.where(WimMeasurement.quality == quality.upper())

    query = query.limit(limit).offset(offset)
    return db.scalars(query).all()


@router.get("/measurements/{measurement_id}", response_model=WimMeasurementOut)
def get_measurement(measurement_id: str, db: Session = Depends(get_db)):
    """Retrieve details for a specific measurement by measurement ID."""
    m = db.scalar(select(WimMeasurement).where(WimMeasurement.measurement_id == measurement_id))
    if m is None:
        raise HTTPException(404, f"Measurement {measurement_id} not found")
    return m


@router.get("/movements/{movement_id}", response_model=WimCorrelationOut)
def get_movement_wim(movement_id: int, db: Session = Depends(get_db)):
    """Retrieve WIM measurement and verification correlation associated with a gate movement."""
    movement = db.get(Movement, movement_id)
    if movement is None:
        raise HTTPException(404, f"Movement {movement_id} not found")

    m = db.scalar(
        select(WimMeasurement)
        .where(WimMeasurement.movement_id == movement_id)
        .order_by(WimMeasurement.id.desc())
    )

    truck = movement.truck
    corr = wim_service.correlate_radar_and_wim(
        radar_length_m=movement.radar_length_m,
        wim_measurement=m,
        truck=truck,
        radar_available=movement.radar_length_m is not None,
        wim_available=m is not None and m.status not in ("FAILED", "TIMEOUT"),
    )

    return WimCorrelationOut(
        overall_status=corr["overall_status"],
        correlation_status=corr["correlation_status"],
        summary=corr["summary"],
        checks=[WimVerificationCheck(**c) for c in corr["checks"]],
        measurement=WimMeasurementOut.model_validate(m) if m else None,
        discrepancy_reason=corr["discrepancy_reason"],
        monitoring_warning=corr["monitoring_warning"],
    )


@router.get("/vehicles/{plate}", response_model=list[WimMeasurementOut])
def get_vehicle_wim_history(plate: str, db: Session = Depends(get_db)):
    """Retrieve WIM measurement history for a specific truck plate."""
    query = select(WimMeasurement).where(WimMeasurement.plate == plate.upper()).order_by(WimMeasurement.id.desc())
    return db.scalars(query).all()


@router.get("/anomalies", response_model=list[WimAnomalyOut])
def list_anomalies(
    status: str | None = None,
    anomaly_type: str | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """List WIM anomalies with filters."""
    query = select(WimAnomaly).order_by(WimAnomaly.id.desc())
    if status:
        query = query.where(WimAnomaly.status == status.upper())
    if anomaly_type:
        query = query.where(WimAnomaly.anomaly_type == anomaly_type.upper())

    query = query.limit(limit).offset(offset)
    anomalies = db.scalars(query).all()
    # attach reviewer name if reviewed
    out = []
    for a in anomalies:
        item = WimAnomalyOut.model_validate(a)
        if a.reviewer:
            item.reviewer_name = a.reviewer.name
        out.append(item)
    return out


@router.post("/anomalies/{anomaly_id}/review", response_model=WimAnomalyOut)
def review_anomaly(
    anomaly_id: int,
    body: WimAnomalyReviewIn,
    db: Session = Depends(get_db),
    officer: Officer = Depends(acting_officer),
):
    """Officer resolves or dismisses an anomaly with required explanation."""
    try:
        a = wim_service.review_anomaly(
            db=db,
            anomaly_id=anomaly_id,
            officer=officer,
            status=body.status,
            reason=body.reason,
        )
        out = WimAnomalyOut.model_validate(a)
        out.reviewer_name = officer.name
        return out
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/dashboard", response_model=WimDashboardMetricsOut)
def get_wim_dashboard(db: Session = Depends(get_db)):
    """Summary metrics for the WIM monitoring dashboard."""
    return wim_service.get_dashboard_metrics(db)


@router.post("/demonstration/{scenario_id}")
def run_demonstration_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Execute one of the 11 official WIM demonstration scenarios (repeatable backend simulation)."""
    try:
        return wim_service.run_demonstration_scenario(db, scenario_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

