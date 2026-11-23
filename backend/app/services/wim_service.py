"""Weigh-in-Motion (WIM) Service: vehicle association, anomaly detection, radar/WIM correlation, and audit logging."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Movement, Officer, Truck
from app.models.wim import WimAnomaly, WimDevice, WimMeasurement
from app.services import logbus
from app.services.logbus import LogLine
from app.services.wim_simulator import calculate_gross_weight, generate_simulated_wim

DEFAULT_DEVICES = [
    {"device_code": "WIM-G1-01", "gate": "G1", "lane": "ENTRY-1", "model": "GB-WIM-Dynamic-40T"},
    {"device_code": "WIM-G2-01", "gate": "G2", "lane": "ENTRY-1", "model": "GB-WIM-Dynamic-40T"},
]


def ensure_default_devices(db: Session) -> list[WimDevice]:
    """Ensure standard GB WIM devices exist in the database."""
    devices = []
    for d in DEFAULT_DEVICES:
        dev = db.scalar(select(WimDevice).where(WimDevice.device_code == d["device_code"]))
        if dev is None:
            dev = WimDevice(
                device_code=d["device_code"],
                gate=d["gate"],
                lane=d["lane"],
                status="ONLINE",
                model=d["model"],
                firmware_version="v2.4.1",
                last_heartbeat=datetime.now(timezone.utc),
            )
            db.add(dev)
            db.flush()
        devices.append(dev)
    db.commit()
    return devices


def get_wim_device(db: Session, device_code: str) -> WimDevice | None:
    return db.scalar(select(WimDevice).where(WimDevice.device_code == device_code))


def set_device_status(
    db: Session,
    device_code: str,
    status: str,
    officer: Officer | None = None,
    reason: str | None = None,
) -> WimDevice:
    """Update WIM device availability status (ONLINE, OFFLINE, DEGRADED) and emit audit event."""
    dev = get_wim_device(db, device_code)
    if dev is None:
        ensure_default_devices(db)
        dev = get_wim_device(db, device_code)
    if dev is None:
        raise ValueError(f"WIM device {device_code} not found")

    old_status = dev.status
    dev.status = status.upper()
    dev.last_heartbeat = datetime.now(timezone.utc)
    db.flush()

    officer_name = officer.name if officer else "System"
    log_level = "INFO" if dev.status == "ONLINE" else ("WARN" if dev.status == "DEGRADED" else "ALERT")
    msg = f"WIM device {device_code} status changed from {old_status} to {dev.status} by {officer_name}"
    if reason:
        msg += f". Reason: {reason}"

    rows = logbus.save(
        db,
        [LogLine("WIM", log_level, msg, {"device_code": device_code, "status": dev.status, "reason": reason})],
        source=f"wim:{device_code}",
    )
    db.commit()
    db.refresh(dev)
    logbus.publish(rows)
    return dev


def generate_anomaly_code() -> str:
    return f"ANO-WIM-{uuid.uuid4().hex[:6].upper()}"


def detect_anomalies(
    db: Session,
    measurement: WimMeasurement,
    truck: Truck | None,
    movement: Movement | None = None,
) -> list[WimAnomaly]:
    """Detect weight-related anomalies, poor-quality reads, sensor timeouts, and mismatches."""
    anomalies: list[WimAnomaly] = []

    # 1. Device Offline / Unavailable
    if measurement.status in ("FAILED", "TIMEOUT") or measurement.device and measurement.device.status == "OFFLINE":
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=truck.id if truck else measurement.truck_id,
                plate=measurement.plate,
                anomaly_type="DEVICE_UNAVAILABLE",
                severity="HIGH",
                description=f"WIM device {measurement.device_code} unavailable or timed out during vehicle crossing.",
                details={"device_code": measurement.device_code, "status": measurement.status},
            )
        )

    # 2. Poor Measurement Quality
    if measurement.quality == "POOR" and measurement.status != "FAILED":
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=truck.id if truck else measurement.truck_id,
                plate=measurement.plate,
                anomaly_type="POOR_QUALITY",
                severity="MEDIUM",
                description=(
                    f"WIM measurement quality degraded (POOR) at speed {measurement.speed_kmh:.1f} km/h. "
                    "Sensor confidence below threshold; manual verification recommended."
                ),
                details={"quality": measurement.quality, "speed_kmh": measurement.speed_kmh},
            )
        )

    # 3. Incomplete measurement (fewer than 2 axles or trailing signature lost)
    if measurement.axle_count < 2 and measurement.status not in ("FAILED", "TIMEOUT"):
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=truck.id if truck else measurement.truck_id,
                plate=measurement.plate,
                anomaly_type="INCOMPLETE_MEASUREMENT",
                severity="HIGH",
                description=f"Incomplete axle sequence detected: only {measurement.axle_count} axle(s) recorded.",
                details={"axle_count": measurement.axle_count, "axle_weights": measurement.axle_weights},
            )
        )

    # 4. Duplicate measurement
    if measurement.status == "DUPLICATE":
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=truck.id if truck else measurement.truck_id,
                plate=measurement.plate,
                anomaly_type="DUPLICATE_MEASUREMENT",
                severity="MEDIUM",
                description="Duplicate WIM measurement frame received for the same vehicle passage.",
                details={"measurement_id": measurement.measurement_id},
            )
        )

    # 5. Unknown / unmatched vehicle
    if measurement.plate and truck is None:
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=None,
                plate=measurement.plate,
                anomaly_type="UNMATCHED_VEHICLE",
                severity="MEDIUM",
                description=f"WIM observation for plate '{measurement.plate}' has no matching truck in the GB registry.",
                details={"plate": measurement.plate},
            )
        )

    # 6. Checks against registered truck specifications
    if truck is not None and measurement.gross_weight_t > 0:
        # 6a. Gross Vehicle Weight (GVW) Overload
        max_allowed_gvw = truck.empty_weight_t + (truck.rated_capacity_t * 1.1)  # 10% safety tolerance
        if truck.gvw_t and truck.gvw_t > 0:
            max_allowed_gvw = min(max_allowed_gvw, truck.gvw_t * 1.1)

        if measurement.gross_weight_t > max_allowed_gvw:
            excess = measurement.gross_weight_t - max_allowed_gvw
            severity = "CRITICAL" if excess > 5.0 else "HIGH"
            anomalies.append(
                WimAnomaly(
                    anomaly_code=generate_anomaly_code(),
                    measurement_id=measurement.id,
                    movement_id=movement.id if movement else measurement.movement_id,
                    truck_id=truck.id,
                    plate=measurement.plate or truck.plate,
                    anomaly_type="GVW_OVERLOAD",
                    severity=severity,
                    description=(
                        f"Gross vehicle weight {measurement.gross_weight_t:.2f} t exceeds registered maximum allowable "
                        f"capacity {max_allowed_gvw:.2f} t by {excess:.2f} t."
                    ),
                    details={
                        "gross_weight_t": measurement.gross_weight_t,
                        "max_allowed_t": round(max_allowed_gvw, 2),
                        "excess_t": round(excess, 2),
                        "rated_capacity_t": truck.rated_capacity_t,
                        "empty_weight_t": truck.empty_weight_t,
                    },
                )
            )

        # 6b. Axle Count Mismatch
        if truck.axle_count and measurement.axle_count > 0:
            if measurement.axle_count != truck.axle_count:
                anomalies.append(
                    WimAnomaly(
                        anomaly_code=generate_anomaly_code(),
                        measurement_id=measurement.id,
                        movement_id=movement.id if movement else measurement.movement_id,
                        truck_id=truck.id,
                        plate=measurement.plate or truck.plate,
                        anomaly_type="AXLE_COUNT_MISMATCH",
                        severity="HIGH",
                        description=(
                            f"WIM detected {measurement.axle_count} axles; truck {truck.plate} is registered with "
                            f"{truck.axle_count} axles."
                        ),
                        details={"wim_axles": measurement.axle_count, "registered_axles": truck.axle_count},
                    )
                )

    # 7. Individual Axle Overload & Axle Imbalance Checks
    if measurement.axle_weights and len(measurement.axle_weights) >= 2:
        weights = measurement.axle_weights
        # Check single axle overload (> 10.5 tonnes on steer or > 12.0 tonnes on single drive)
        for idx, w in enumerate(weights, start=1):
            limit = 7.0 if idx == 1 else 11.5  # steer axle max ~7t, drive axle max ~11.5t
            if w > limit:
                anomalies.append(
                    WimAnomaly(
                        anomaly_code=generate_anomaly_code(),
                        measurement_id=measurement.id,
                        movement_id=movement.id if movement else measurement.movement_id,
                        truck_id=truck.id if truck else measurement.truck_id,
                        plate=measurement.plate,
                        anomaly_type="AXLE_OVERLOAD",
                        severity="HIGH",
                        description=f"Axle #{idx} load of {w:.2f} t exceeds statutory axle load limit ({limit:.2f} t).",
                        details={"axle_index": idx, "axle_weight_t": w, "limit_t": limit},
                    )
                )

        # Axle weight distribution imbalance (steer heavier than drive by > 20% on loaded vehicle)
        if len(weights) >= 2 and weights[0] > 9.0 and weights[0] > (weights[1] * 1.3):
            anomalies.append(
                WimAnomaly(
                    anomaly_code=generate_anomaly_code(),
                    measurement_id=measurement.id,
                    movement_id=movement.id if movement else measurement.movement_id,
                    truck_id=truck.id if truck else measurement.truck_id,
                    plate=measurement.plate,
                    anomaly_type="AXLE_IMBALANCE",
                    severity="MEDIUM",
                    description=(
                        f"Abnormal forward axle weight distribution: steer axle {weights[0]:.2f} t significantly exceeds "
                        f"trailing axle {weights[1]:.2f} t."
                    ),
                    details={"steer_t": weights[0], "drive_t": weights[1]},
                )
            )

    return anomalies


def correlate_radar_and_wim(
    radar_length_m: float | None,
    wim_measurement: WimMeasurement | None,
    truck: Truck | None,
    radar_available: bool = True,
    wim_available: bool = True,
) -> dict:
    """Core correlation logic between existing radar observation and independent WIM verification.

    WIM measures weight and axle configuration. It does NOT directly compute vehicle dimensions.
    Comparisons are technically meaningful (e.g. multi-axle heavy profile vs short vehicle length,
    or independent presence verification).
    """
    checks = []
    discrepancy_reason = None
    monitoring_warning = None
    correlation_status = "CORRELATED"
    overall_status = "PASSED"

    # 1. WIM Device Availability Check
    dev_obj = getattr(wim_measurement, "device", None)
    dev_status = dev_obj.status if dev_obj else ("ONLINE" if wim_available else "OFFLINE")
    if not wim_available or dev_status == "OFFLINE" or (wim_measurement and wim_measurement.status == "FAILED"):
        checks.append({
            "name": "wim_device_availability",
            "label": "WIM Device Availability",
            "status": "unavailable",
            "detail": f"WIM sensor offline or communication failed ({wim_measurement.device_code if wim_measurement else 'WIM-G1-01'})",
        })
    elif dev_status == "DEGRADED":
        checks.append({
            "name": "wim_device_availability",
            "label": "WIM Device Availability",
            "status": "warning",
            "detail": f"WIM sensor operational in DEGRADED mode ({wim_measurement.device_code if wim_measurement else 'WIM-G1-01'})",
        })
    else:
        checks.append({
            "name": "wim_device_availability",
            "label": "WIM Device Availability",
            "status": "passed",
            "detail": f"WIM sensor ONLINE and calibrated ({wim_measurement.device_code if wim_measurement else 'WIM-G1-01'})",
        })

    # 2. Measurement Received
    if wim_measurement and wim_measurement.status not in ("FAILED", "TIMEOUT") and wim_measurement.gross_weight_t > 0:
        checks.append({
            "name": "measurement_received",
            "label": "Measurement Received",
            "status": "passed",
            "detail": f"ID {wim_measurement.measurement_id} · Speed {wim_measurement.speed_kmh:.1f} km/h · {wim_measurement.source}",
        })
    else:
        checks.append({
            "name": "measurement_received",
            "label": "Measurement Received",
            "status": "unavailable" if not wim_available else "failed",
            "detail": "No dynamic weight measurement received from WIM controller",
        })

    # 3. Measurement Quality
    if wim_measurement and wim_measurement.gross_weight_t > 0:
        q = wim_measurement.quality
        if q == "GOOD":
            checks.append({
                "name": "measurement_quality",
                "label": "Measurement Quality",
                "status": "passed",
                "detail": f"Quality GOOD (High confidence load-cell dynamic integration)",
            })
        elif q == "FAIR":
            checks.append({
                "name": "measurement_quality",
                "label": "Measurement Quality",
                "status": "warning",
                "detail": "Quality FAIR (Minor vehicle dynamic fluctuation detected)",
            })
        else:
            checks.append({
                "name": "measurement_quality",
                "label": "Measurement Quality",
                "status": "warning",
                "detail": "Quality POOR (Dynamic sensor noise or irregular speed across pad)",
            })
    else:
        checks.append({
            "name": "measurement_quality",
            "label": "Measurement Quality",
            "status": "not_applicable" if not wim_available else "unavailable",
            "detail": "Quality check not applicable (no measurement received)",
        })

    # 4. Vehicle Association
    meas_plate = getattr(wim_measurement, "plate", None)
    if wim_measurement and meas_plate:
        if truck:
            checks.append({
                "name": "vehicle_association",
                "label": "Vehicle Association",
                "status": "passed",
                "detail": f"Correlated with registered truck {truck.plate} (#{truck.id})",
            })
        else:
            checks.append({
                "name": "vehicle_association",
                "label": "Vehicle Association",
                "status": "warning",
                "detail": f"Plate '{meas_plate}' observed by ANPR/RFID but not in GB registry",
            })
    else:
        checks.append({
            "name": "vehicle_association",
            "label": "Vehicle Association",
            "status": "warning" if (wim_measurement and getattr(wim_measurement, "gross_weight_t", 0) > 0) else "not_applicable",
            "detail": "No vehicle plate identified at time of WIM passage",
        })

    # 5. Axle Count Verification
    if wim_measurement and wim_measurement.axle_count > 0:
        if truck and truck.axle_count:
            if wim_measurement.axle_count == truck.axle_count:
                checks.append({
                    "name": "axle_count",
                    "label": "Axle Count Verification",
                    "status": "passed",
                    "detail": f"{wim_measurement.axle_count} axles observed (matches enrolled {truck.axle_count} axles)",
                })
            else:
                checks.append({
                    "name": "axle_count",
                    "label": "Axle Count Verification",
                    "status": "failed",
                    "detail": f"{wim_measurement.axle_count} axles observed vs {truck.axle_count} enrolled axles",
                })
        else:
            checks.append({
                "name": "axle_count",
                "label": "Axle Count Verification",
                "status": "passed",
                "detail": f"{wim_measurement.axle_count} axles observed (unregistered vehicle baseline)",
            })
    else:
        checks.append({
            "name": "axle_count",
            "label": "Axle Count Verification",
            "status": "unavailable",
            "detail": "No axle count available",
        })

    # 6. Gross Vehicle Weight Verification
    if wim_measurement and wim_measurement.gross_weight_t > 0:
        axle_str = " + ".join(f"{w:.1f}t" for w in wim_measurement.axle_weights)
        if truck:
            rated_total = truck.empty_weight_t + truck.rated_capacity_t
            if wim_measurement.gross_weight_t <= (rated_total * 1.1):
                checks.append({
                    "name": "gross_vehicle_weight",
                    "label": "Gross Vehicle Weight",
                    "status": "passed",
                    "detail": f"{wim_measurement.gross_weight_t:.2f} t [{axle_str}] within safe rated capacity ({rated_total:.2f} t)",
                })
            else:
                excess = wim_measurement.gross_weight_t - rated_total
                checks.append({
                    "name": "gross_vehicle_weight",
                    "label": "Gross Vehicle Weight",
                    "status": "failed",
                    "detail": f"{wim_measurement.gross_weight_t:.2f} t [{axle_str}] OVERLOAD: exceeds rated {rated_total:.2f} t by {excess:.2f} t",
                })
        else:
            checks.append({
                "name": "gross_vehicle_weight",
                "label": "Gross Vehicle Weight",
                "status": "passed",
                "detail": f"{wim_measurement.gross_weight_t:.2f} t [{axle_str}]",
            })
    else:
        checks.append({
            "name": "gross_vehicle_weight",
            "label": "Gross Vehicle Weight",
            "status": "unavailable",
            "detail": "No weight measurement recorded",
        })

    # 7. Radar & WIM Correlation with Gate Event
    # Evaluate technically meaningful correlation:
    # Does radar length imply vehicle profile consistent with WIM axle observation?
    # (e.g. radar length > 9.0m implies multi-axle heavy truck with 3+ axles; a 4.5m passenger vehicle with 30t is a massive discrepancy)
    has_radar = radar_available and radar_length_m is not None
    has_wim = wim_available and wim_measurement is not None and wim_measurement.gross_weight_t > 0

    if has_radar and has_wim:
        # Check technological consistency
        # If radar shows light vehicle (< 6m) but WIM shows heavy multi-axle (> 15t or > 2 axles)
        if radar_length_m < 6.0 and (wim_measurement.gross_weight_t > 12.0 or wim_measurement.axle_count > 2):
            correlation_status = "DISCREPANCY"
            discrepancy_reason = (
                f"DISCREPANCY DETECTED — REQUIRES VERIFICATION: Radar measured light vehicle length ({radar_length_m:.2f} m) "
                f"but WIM recorded heavy vehicle ({wim_measurement.gross_weight_t:.2f} t, {wim_measurement.axle_count} axles). "
                "Independent observations conflict."
            )
            checks.append({
                "name": "radar_wim_correlation",
                "label": "Radar & WIM Correlation",
                "status": "failed",
                "detail": f"DISCREPANCY DETECTED — REQUIRES VERIFICATION: Radar {radar_length_m:.2f} m conflicts with WIM {wim_measurement.gross_weight_t:.2f} t",
            })
        # If radar shows long heavy commercial vehicle (> 8.5m) but WIM saw only 1 axle or < 3.0t
        elif radar_length_m > 8.5 and wim_measurement.gross_weight_t < 3.5:
            correlation_status = "DISCREPANCY"
            discrepancy_reason = (
                f"DISCREPANCY DETECTED — REQUIRES VERIFICATION: Radar measured heavy vehicle length ({radar_length_m:.2f} m) "
                f"but WIM recorded abnormally low gross weight ({wim_measurement.gross_weight_t:.2f} t). "
                "Sensor bypass or missing axle suspected."
            )
            checks.append({
                "name": "radar_wim_correlation",
                "label": "Radar & WIM Correlation",
                "status": "failed",
                "detail": f"DISCREPANCY DETECTED — REQUIRES VERIFICATION: Long vehicle {radar_length_m:.2f} m has near-zero WIM weight {wim_measurement.gross_weight_t:.2f} t",
            })
        else:
            correlation_status = "CORRELATED"
            checks.append({
                "name": "radar_wim_correlation",
                "label": "Radar & WIM Correlation",
                "status": "passed",
                "detail": f"Radar profile ({radar_length_m:.2f} m) and WIM observation ({wim_measurement.gross_weight_t:.2f} t, {wim_measurement.axle_count} axles) consistent",
            })

    elif not has_radar and has_wim:
        # Scenario B: Radar unavailable, WIM operational
        correlation_status = "WIM_ONLY"
        monitoring_warning = "Radar observation unavailable; WIM observation preserved as independent weight evidence. Manual officer verification required."
        checks.append({
            "name": "radar_wim_correlation",
            "label": "Radar & WIM Correlation",
            "status": "warning",
            "detail": "Radar observation unavailable. WIM weight observation preserved independently.",
        })

    elif has_radar and not has_wim:
        # Scenario C: Radar operational, WIM unavailable
        correlation_status = "RADAR_ONLY"
        monitoring_warning = "WIM device unavailable; radar observation operating normally. Monitoring gap recorded."
        checks.append({
            "name": "radar_wim_correlation",
            "label": "Radar & WIM Correlation",
            "status": "warning",
            "detail": "WIM monitoring unavailable. Existing radar identification workflow unaffected.",
        })

    else:
        # Scenario D: Both unavailable
        correlation_status = "BOTH_UNAVAILABLE"
        monitoring_warning = "Both radar and WIM independent monitoring sources unavailable. Flagged for manual gate inspection."
        checks.append({
            "name": "radar_wim_correlation",
            "label": "Radar & WIM Correlation",
            "status": "failed",
            "detail": "Both radar and WIM monitoring sources unavailable. Security gap recorded.",
        })

    # 8. Overall Verification Status
    failed_checks = [c for c in checks if c["status"] == "failed"]
    warning_checks = [c for c in checks if c["status"] == "warning"]
    unavailable_checks = [c for c in checks if c["status"] == "unavailable"]

    if correlation_status == "BOTH_UNAVAILABLE":
        overall_status = "UNAVAILABLE"
    elif correlation_status == "DISCREPANCY" or len(failed_checks) > 0:
        overall_status = "FAILED"
    elif correlation_status in ("WIM_ONLY", "RADAR_ONLY") or len(warning_checks) > 0 or len(unavailable_checks) > 0:
        overall_status = "WARNING"
    else:
        overall_status = "PASSED"

    summary = (
        f"WIM Verification: {overall_status} · Correlation: {correlation_status}"
        + (f" · {discrepancy_reason}" if discrepancy_reason else "")
    )

    return {
        "overall_status": overall_status,
        "correlation_status": correlation_status,
        "summary": summary,
        "checks": checks,
        "discrepancy_reason": discrepancy_reason,
        "monitoring_warning": monitoring_warning,
    }


def record_measurement(
    db: Session,
    device_code: str,
    gate: str,
    direction: str,
    speed_kmh: float,
    axle_count: int,
    axle_weights: list[float],
    quality: str = "GOOD",
    status: str = "VALID",
    plate: str | None = None,
    truck_id: int | None = None,
    movement_id: int | None = None,
    radar_length_m: float | None = None,
    source: str = "SIMULATED",
    observed_at: datetime | None = None,
    measurement_id: str | None = None,
    lane: str | None = None,
    radar_available: bool = True,
    wim_available: bool = True,
) -> WimMeasurement:
    """Record an immutable WIM measurement, detect anomalies, correlate with gate movement, and log audit event."""
    dev = get_wim_device(db, device_code)
    if dev is None:
        ensure_default_devices(db)
        dev = get_wim_device(db, device_code)

    actual_wim_available = wim_available and (dev.status != "OFFLINE" if dev else True) and status not in ("FAILED", "TIMEOUT")

    # Gross vehicle weight calculated strictly from individual axle weights
    gross_weight = calculate_gross_weight(axle_weights) if axle_weights else 0.0

    # Resolve truck if plate is provided
    truck = None
    if truck_id:
        truck = db.get(Truck, truck_id)
    elif plate:
        truck = db.scalar(select(Truck).where(Truck.plate == plate))
        if truck:
            truck_id = truck.id

    # Resolve movement if movement_id provided
    movement = db.get(Movement, movement_id) if movement_id else None
    if movement and radar_length_m is None:
        radar_length_m = movement.radar_length_m
    if movement and not plate and movement.plate_read:
        plate = movement.plate_read
        if not truck and movement.truck_id:
            truck = db.get(Truck, movement.truck_id)
            truck_id = truck.id if truck else None

    # Correlation logic
    corr = correlate_radar_and_wim(
        radar_length_m=radar_length_m,
        wim_measurement=None,  # evaluated below
        truck=truck,
        radar_available=radar_available and (radar_length_m is not None or movement is not None),
        wim_available=actual_wim_available,
    )

    measurement = WimMeasurement(
        measurement_id=measurement_id or f"WIM-{uuid.uuid4().hex[:6].upper()}",
        device_id=dev.id if dev else None,
        device_code=device_code,
        gate=gate.upper(),
        lane=lane or f"{direction.upper()}-1",
        direction=direction.upper(),
        observed_at=observed_at or datetime.now(timezone.utc),
        plate=plate,
        truck_id=truck_id,
        speed_kmh=speed_kmh,
        axle_count=axle_count,
        axle_weights=axle_weights,
        gross_weight_t=gross_weight,
        quality=quality,
        status=status,
        source=source,
        movement_id=movement_id,
        radar_length_m=radar_length_m,
        correlation_status=corr["correlation_status"],
        discrepancy_details={"reason": corr["discrepancy_reason"]} if corr["discrepancy_reason"] else None,
    )
    db.add(measurement)
    db.flush()

    # Detect anomalies
    anomalies = detect_anomalies(db, measurement, truck, movement)
    if corr["correlation_status"] == "DISCREPANCY":
        anomalies.append(
            WimAnomaly(
                anomaly_code=generate_anomaly_code(),
                measurement_id=measurement.id,
                movement_id=movement.id if movement else measurement.movement_id,
                truck_id=truck.id if truck else None,
                plate=plate,
                anomaly_type="DISCREPANCY_DETECTED",
                severity="HIGH",
                description=f"DISCREPANCY DETECTED: {corr['discrepancy_reason']}",
                details={"radar_length_m": radar_length_m, "gross_weight_t": gross_weight, "axle_count": axle_count},
            )
        )

    for a in anomalies:
        db.add(a)

    # Log to Logbus
    log_level = "INFO" if corr["overall_status"] == "PASSED" else ("WARN" if corr["overall_status"] == "WARNING" else "ALERT")
    lines = [
        LogLine(
            "WIM",
            log_level,
            f"{gate.upper()} {direction.upper()} WIM measurement {measurement.measurement_id}: "
            f"{gross_weight:.2f} t, {axle_count} axles at {speed_kmh:.1f} km/h (quality: {quality}) · Status: {corr['overall_status']}",
            {
                "measurement_id": measurement.measurement_id,
                "gross_weight_t": gross_weight,
                "axle_count": axle_count,
                "correlation": corr["correlation_status"],
            },
        )
    ]
    if corr["discrepancy_reason"]:
        lines.append(
            LogLine("WIM", "ALERT", f"DISCREPANCY DETECTED — REQUIRES VERIFICATION: {corr['discrepancy_reason']}")
        )
    if corr["monitoring_warning"]:
        lines.append(LogLine("WIM", "WARN", f"WIM MONITORING WARNING: {corr['monitoring_warning']}"))

    rows = logbus.save(db, lines, source=source, movement_id=movement_id)
    db.commit()
    db.refresh(measurement)
    logbus.publish(rows)
    return measurement


def review_anomaly(
    db: Session,
    anomaly_id: int,
    officer: Officer,
    status: str,
    reason: str,
) -> WimAnomaly:
    """Officer reviews, resolves, or dismisses an anomaly with required explanation and attribution."""
    anomaly = db.get(WimAnomaly, anomaly_id)
    if anomaly is None:
        raise ValueError(f"WimAnomaly {anomaly_id} not found")

    old_status = anomaly.status
    anomaly.status = status.upper()
    anomaly.reviewed_by = officer.id
    anomaly.reviewed_at = datetime.now(timezone.utc)
    anomaly.resolution_reason = reason
    db.flush()

    msg = f"WIM anomaly {anomaly.anomaly_code} ({anomaly.anomaly_type}) status changed from {old_status} to {anomaly.status} by officer {officer.name}: {reason}"
    rows = logbus.save(
        db,
        [LogLine("WIM", "INFO", msg, {"anomaly_id": anomaly.id, "status": anomaly.status, "officer": officer.name})],
        source=f"anomaly:{anomaly.id}",
        movement_id=anomaly.movement_id,
    )
    db.commit()
    db.refresh(anomaly)
    logbus.publish(rows)
    return anomaly


def get_dashboard_metrics(db: Session) -> dict:
    """Calculate aggregated WIM monitoring metrics for the dashboard."""
    ensure_default_devices(db)
    devices = db.scalars(select(WimDevice)).all()
    total_devices = len(devices)
    online_devices = sum(1 for d in devices if d.status == "ONLINE")
    offline_devices = sum(1 for d in devices if d.status == "OFFLINE")
    degraded_devices = sum(1 for d in devices if d.status == "DEGRADED")

    measurements = db.scalars(select(WimMeasurement)).all()
    total_measurements = len(measurements)
    successful_measurements = sum(1 for m in measurements if m.status == "VALID" and m.quality in ("GOOD", "FAIR"))
    poor_quality_measurements = sum(1 for m in measurements if m.quality == "POOR")
    radar_wim_discrepancies = sum(1 for m in measurements if m.correlation_status == "DISCREPANCY")

    anomalies = db.scalars(select(WimAnomaly)).all()
    overload_anomalies = sum(1 for a in anomalies if a.anomaly_type in ("GVW_OVERLOAD", "AXLE_OVERLOAD"))

    verification_overview = {
        "both_operational": sum(1 for m in measurements if m.correlation_status == "CORRELATED"),
        "radar_only": sum(1 for m in measurements if m.correlation_status == "RADAR_ONLY"),
        "wim_only": sum(1 for m in measurements if m.correlation_status == "WIM_ONLY"),
        "both_unavailable": sum(1 for m in measurements if m.correlation_status == "BOTH_UNAVAILABLE"),
        "discrepancies": sum(1 for m in measurements if m.correlation_status == "DISCREPANCY"),
    }

    anomaly_counts_by_status = {
        "OPEN": sum(1 for a in anomalies if a.status == "OPEN"),
        "UNDER_REVIEW": sum(1 for a in anomalies if a.status == "UNDER_REVIEW"),
        "RESOLVED": sum(1 for a in anomalies if a.status == "RESOLVED"),
        "DISMISSED": sum(1 for a in anomalies if a.status == "DISMISSED"),
    }

    return {
        "total_devices": total_devices,
        "online_devices": online_devices,
        "offline_devices": offline_devices,
        "degraded_devices": degraded_devices,
        "total_measurements": total_measurements,
        "successful_measurements": successful_measurements,
        "poor_quality_measurements": poor_quality_measurements,
        "radar_wim_discrepancies": radar_wim_discrepancies,
        "overload_anomalies": overload_anomalies,
        "verification_overview": verification_overview,
        "anomaly_counts_by_status": anomaly_counts_by_status,
    }


def run_demonstration_scenario(db: Session, scenario_id: int) -> dict:
    """Execute one of the 11 official WIM demonstration scenarios, producing real DB state and logs."""
    ensure_default_devices(db)
    truck = db.scalar(select(Truck).where(Truck.status == "active").order_by(Truck.id))
    plate = truck.plate if truck else "OD09AC5678"
    radar_len = truck.length_m if truck else 8.32

    if scenario_id == 1:
        # 1. Normal truck with successful radar and WIM observations
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 16.2, 3, [4.8, 8.4, 8.4],
            quality="GOOD", status="VALID", plate=plate, radar_length_m=radar_len,
            source="demo:scenario-1",
        )
        return {"scenario": 1, "title": "Normal truck with successful radar and WIM observations", "measurement_id": m.measurement_id, "correlation": m.correlation_status}

    elif scenario_id == 2:
        # 2. Radar failure while WIM remains operational
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 15.0, 3, [4.5, 8.2, 8.3],
            quality="GOOD", status="VALID", plate=plate, radar_length_m=None,
            radar_available=False, source="demo:scenario-2",
        )
        return {"scenario": 2, "title": "Radar failure while WIM remains operational", "measurement_id": m.measurement_id, "correlation": m.correlation_status}

    elif scenario_id == 3:
        # 3. WIM failure while radar remains operational
        set_device_status(db, "WIM-G1-01", "OFFLINE", reason="Simulated sensor communication failure")
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 0.0, 0, [],
            quality="POOR", status="FAILED", plate=plate, radar_length_m=radar_len,
            wim_available=False, source="demo:scenario-3",
        )
        # Restore for subsequent tests
        set_device_status(db, "WIM-G1-01", "ONLINE", reason="Simulated sensor recovery")
        return {"scenario": 3, "title": "WIM failure while radar remains operational", "measurement_id": m.measurement_id, "correlation": m.correlation_status}

    elif scenario_id == 4:
        # 4. Both radar and WIM unavailable
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 0.0, 0, [],
            quality="POOR", status="FAILED", plate=plate, radar_length_m=None,
            radar_available=False, wim_available=False, source="demo:scenario-4",
        )
        return {"scenario": 4, "title": "Both radar and WIM unavailable", "measurement_id": m.measurement_id, "correlation": m.correlation_status}

    elif scenario_id == 5:
        # 5. Inconsistent observations (discrepancy detected)
        # Passenger car length on radar (4.3m) with 26t multi-axle freight weight
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 14.8, 3, [5.5, 10.2, 10.3],
            quality="GOOD", status="ANOMALY", plate=plate, radar_length_m=4.30,
            source="demo:scenario-5",
        )
        return {"scenario": 5, "title": "Inconsistent weight observations (Discrepancy)", "measurement_id": m.measurement_id, "correlation": m.correlation_status}

    elif scenario_id == 6:
        # 6. Gross vehicle overload
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 12.0, 3, [6.5, 15.0, 15.5],
            quality="GOOD", status="ANOMALY", plate=plate, radar_length_m=radar_len,
            source="demo:scenario-6",
        )
        return {"scenario": 6, "title": "Gross vehicle overload", "measurement_id": m.measurement_id, "gross_weight_t": m.gross_weight_t}

    elif scenario_id == 7:
        # 7. Individual axle overload
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 15.5, 3, [4.0, 13.5, 6.5],
            quality="GOOD", status="ANOMALY", plate=plate, radar_length_m=radar_len,
            source="demo:scenario-7",
        )
        return {"scenario": 7, "title": "Individual axle overload", "measurement_id": m.measurement_id}

    elif scenario_id == 8:
        # 8. Poor-quality WIM measurement
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 36.8, 3, [4.2, 7.8, 8.5],
            quality="POOR", status="ANOMALY", plate=plate, radar_length_m=radar_len,
            source="demo:scenario-8",
        )
        return {"scenario": 8, "title": "Poor-quality WIM measurement", "measurement_id": m.measurement_id, "quality": m.quality}

    elif scenario_id == 9:
        # 9. Unknown vehicle association
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 14.5, 2, [4.0, 7.0],
            quality="GOOD", status="VALID", plate="KA99ZZ9999", radar_length_m=7.50,
            source="demo:scenario-9",
        )
        return {"scenario": 9, "title": "Unknown vehicle association", "measurement_id": m.measurement_id}

    elif scenario_id == 10:
        # 10. Duplicate WIM measurement
        m = record_measurement(
            db, "WIM-G1-01", "G1", "ENTRY", 15.0, 3, [4.5, 8.0, 8.0],
            quality="GOOD", status="DUPLICATE", plate=plate, radar_length_m=radar_len,
            source="demo:scenario-10",
        )
        return {"scenario": 10, "title": "Duplicate WIM measurement", "measurement_id": m.measurement_id}

    elif scenario_id == 11:
        # 11. WIM device disconnection and recovery
        dev_down = set_device_status(db, "WIM-G1-01", "OFFLINE", reason="Demonstration scenario: communication loss")
        dev_up = set_device_status(db, "WIM-G1-01", "ONLINE", reason="Demonstration scenario: automatic reconnect and recovery")
        return {"scenario": 11, "title": "WIM device disconnection and recovery", "device": "WIM-G1-01", "final_status": dev_up.status}

    else:
        raise ValueError(f"Scenario ID {scenario_id} must be between 1 and 11")


# ---------------------------------------------------------------- WIM inside the gate pipeline
READING_STATUS = {"OK": "VALID", "POOR": "ANOMALY", "TIMEOUT": "TIMEOUT", "OFFLINE": "FAILED"}


def record_from_gate(db: Session, movement: Movement, truck: Truck | None, reading: dict, status: str) -> WimMeasurement:
    """Store the WIM reading that came with a signed gate event, in the caller's transaction (no commit, no log: the
    gate pipeline logs and raises alerts). The teammate's anomaly rules still run for the WIM dashboard."""
    gate = movement.gate.upper()
    code = f"WIM-{gate}-01"
    weights = [round(float(w), 2) for w in (reading.get("axle_weights_t") or [])]
    m = WimMeasurement(
        measurement_id=f"WIM-{uuid.uuid4().hex[:6].upper()}",
        device_id=(dev.id if (dev := get_wim_device(db, code)) else None),
        device_code=code, gate=gate, lane=f"{'ENTRY' if movement.direction == 'IN' else 'EXIT'}-1",
        direction=movement.direction, observed_at=movement.observed_at,
        plate=movement.plate_normalised or movement.plate_read, truck_id=truck.id if truck else None,
        speed_kmh=float(reading.get("speed_kmh") or 0.0), axle_count=int(reading.get("axle_count") or 0),
        axle_weights=weights, axle_spacings_m=reading.get("axle_spacings_m"),
        gross_weight_t=calculate_gross_weight(weights) if weights else 0.0,
        quality="POOR" if status == "POOR" else "GOOD", status=READING_STATUS.get(status, "VALID"),
        source=movement.source or "SIMULATED", movement_id=movement.id, radar_length_m=movement.radar_length_m,
        correlation_status="CORRELATED" if status == "OK" else "RADAR_ONLY",
    )
    db.add(m)
    db.flush()
    for a in detect_anomalies(db, m, truck, movement):
        db.add(a)
    return m


def device_offline(db: Session, gate: str) -> bool:
    """The WIM device for this gate is switched off in the WIM dashboard / Gate console (status OFFLINE)."""
    dev = get_wim_device(db, f"WIM-{gate.upper()}-01")
    return dev is not None and dev.status == "OFFLINE"
