"""WIM Simulator: generates realistic structured dynamic weight measurement records.

All readings are simulated in software (POC). Gross weight is calculated directly from
individual axle measurements.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import random
import uuid


@dataclass
class SimulatedWimReading:
    measurement_id: str
    device_code: str
    gate: str
    lane: str
    direction: str  # ENTRY | EXIT
    observed_at: datetime
    speed_kmh: float
    axle_count: int
    axle_weights: list[float]
    gross_weight_t: float
    quality: str  # GOOD | FAIR | POOR
    status: str  # VALID | ANOMALY | FAILED | TIMEOUT | UNMATCHED | DUPLICATE
    plate: str | None = None
    source: str = "SIMULATED"
    scenario: str = "normal"
    notes: str = ""


def next_measurement_id() -> str:
    return f"WIM-{uuid.uuid4().hex[:8].upper()}"


def calculate_gross_weight(axle_weights: list[float]) -> float:
    """Gross vehicle weight is strictly derived by summing individual axle loads."""
    return round(sum(axle_weights), 2)


def generate_simulated_wim(
    scenario: str = "normal_2axle",
    gate: str = "G1",
    direction: str = "ENTRY",
    device_code: str | None = None,
    plate: str | None = None,
    observed_at: datetime | None = None,
    speed_kmh: float | None = None,
    custom_axle_weights: list[float] | None = None,
    custom_quality: str | None = None,
    known_truck_specs: dict | None = None,
) -> SimulatedWimReading:
    """Generate a simulated WIM measurement matching the requested scenario."""
    gate = gate.upper()
    direction = direction.upper()
    lane = f"{direction}-1" if direction in ("ENTRY", "EXIT") else ("ENTRY-1" if direction == "IN" else "EXIT-1")
    dev_code = device_code or f"WIM-{gate}-01"
    now = observed_at or datetime.now(timezone.utc)

    # 1. Custom axle weights override if provided
    if custom_axle_weights:
        weights = [round(w, 2) for w in custom_axle_weights]
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 15.0
        quality = custom_quality or "GOOD"
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=len(weights),
            axle_weights=weights,
            gross_weight_t=gross,
            quality=quality,
            status="VALID" if quality != "POOR" else "ANOMALY",
            scenario=scenario,
            notes="Custom configured axle measurements",
        )

    # 2. Check truck specs if known (enrolled length, rated capacity, empty weight, axle count)
    truck_axles = known_truck_specs.get("axle_count") if known_truck_specs else None
    empty_weight = known_truck_specs.get("empty_weight_t", 10.0) if known_truck_specs else 10.0
    rated_capacity = known_truck_specs.get("rated_capacity_t", 25.0) if known_truck_specs else 25.0

    # 3. Branch by Scenario
    norm_scenario = scenario.lower()

    if norm_scenario == "normal_2axle" or (norm_scenario == "normal" and truck_axles == 2):
        # 2-axle truck (e.g., steer axle ~3.8t-4.5t, rear drive axle ~6.0t-9.0t)
        steer = round(random.uniform(3.8, 4.5), 2)
        drive = round(random.uniform(6.5, 8.5), 2)
        weights = [steer, drive]
        speed = speed_kmh if speed_kmh is not None else round(random.uniform(12.0, 18.0), 1)
        gross = calculate_gross_weight(weights)
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=2,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="VALID",
            scenario="normal_2axle",
            notes="Normal 2-axle truck measurement within legal limits",
        )

    elif norm_scenario == "normal_3axle" or (norm_scenario == "normal" and (truck_axles == 3 or truck_axles is None)):
        # 3-axle truck (steer ~4.5t, tandem rear ~8.0t + ~8.0t = ~20.5t gross)
        steer = round(random.uniform(4.5, 5.2), 2)
        tandem1 = round(random.uniform(7.8, 8.8), 2)
        tandem2 = round(random.uniform(7.8, 8.8), 2)
        weights = [steer, tandem1, tandem2]
        speed = speed_kmh if speed_kmh is not None else round(random.uniform(14.0, 22.0), 1)
        gross = calculate_gross_weight(weights)
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=3,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="VALID",
            scenario="normal_3axle",
            notes="Normal 3-axle tipper measurement with balanced tandem bogie",
        )

    elif norm_scenario == "normal_multiaxle" or (norm_scenario == "normal" and truck_axles and truck_axles >= 4):
        # 4-axle heavy hauler (steer ~5.0t, lift axle ~6.5t, tandem drive ~8.5t + ~8.5t = ~28.5t)
        count = truck_axles if truck_axles and truck_axles >= 4 else 4
        steer = round(random.uniform(4.8, 5.5), 2)
        axle2 = round(random.uniform(6.0, 7.5), 2)
        axle3 = round(random.uniform(8.0, 9.0), 2)
        axle4 = round(random.uniform(8.0, 9.0), 2)
        weights = [steer, axle2, axle3, axle4]
        if count > 4:
            for _ in range(count - 4):
                weights.append(round(random.uniform(7.5, 8.5), 2))
        speed = speed_kmh if speed_kmh is not None else round(random.uniform(10.0, 16.0), 1)
        gross = calculate_gross_weight(weights)
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=len(weights),
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="VALID",
            scenario="normal_multiaxle",
            notes=f"Normal {len(weights)}-axle multi-axle freight carrier",
        )

    elif norm_scenario in ("gvw_overload", "overload"):
        # Abnormally high gross weight (e.g. 130%-150% of rated capacity)
        # 3-axle truck carrying 36 tonnes instead of safe 25 tonnes
        steer = 6.2
        tandem1 = 14.8
        tandem2 = 15.0
        weights = [steer, tandem1, tandem2]
        gross = calculate_gross_weight(weights)  # 36.0 tonnes
        speed = speed_kmh if speed_kmh is not None else 12.5
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=3,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="ANOMALY",
            scenario="gvw_overload",
            notes=f"Gross vehicle weight {gross:.2f} t severely exceeds safe carrying capacity",
        )

    elif norm_scenario == "axle_overload":
        # Individual axle overload: gross weight may look borderline OK, but rear axle is overloaded (>11.5 tonnes)
        # e.g., cargo shifted completely onto drive axle
        steer = 3.5
        axle2 = 12.8  # Overload on single drive axle (legal limit 10.2t)
        axle3 = 6.0
        weights = [steer, axle2, axle3]
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 15.0
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=3,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="ANOMALY",
            scenario="axle_overload",
            notes="Axle #2 load 12.80 t exceeds statutory axle limit (10.20 t)",
        )

    elif norm_scenario == "axle_imbalance":
        # Abnormal axle weight distribution: steering axle has 65% of weight due to improper forward stacking
        steer = 11.2
        rear = 4.1
        weights = [steer, rear]
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 14.0
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=2,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="FAIR",
            status="ANOMALY",
            scenario="axle_imbalance",
            notes="Severe forward center-of-gravity imbalance: steer axle 11.20 t > drive axle 4.10 t",
        )

    elif norm_scenario in ("poor_quality", "sensor_noise"):
        # Poor-quality measurement: vehicle accelerated or braked abruptly across sensor pad
        steer = 4.2
        tandem1 = 7.1
        tandem2 = 8.9
        weights = [steer, tandem1, tandem2]
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 38.5  # Excessive speed over WIM pad
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=3,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="POOR",
            status="ANOMALY",
            scenario="poor_quality",
            notes="Sensor signal degraded: erratic vehicle speed / dynamic bounce across load cell",
        )

    elif norm_scenario in ("incomplete_measurement", "missing_axle"):
        # Incomplete measurement: trailer axle bypassed or sensor failed to trip on rear axle
        steer = 4.3
        tandem1 = 8.1
        weights = [steer, tandem1]  # Only 2 axles recorded for a 3-axle tipper
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 28.0
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=2,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="POOR",
            status="ANOMALY",
            scenario="incomplete_measurement",
            notes="Incomplete measurement: missing rear axle record. Trailing signature truncated.",
        )

    elif norm_scenario == "axle_count_mismatch":
        # Vehicle registered as 2-axle or 4-axle, but WIM detects 3 axles
        steer = 4.5
        axle2 = 8.0
        axle3 = 8.0
        weights = [steer, axle2, axle3]
        gross = calculate_gross_weight(weights)
        speed = speed_kmh if speed_kmh is not None else 16.0
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=speed,
            axle_count=3,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="ANOMALY",
            scenario="axle_count_mismatch",
            notes="Axle count 3 detected; mismatch with registered vehicle specification",
        )

    elif norm_scenario in ("device_offline", "device_failure"):
        # WIM device is offline or unavailable
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=0.0,
            axle_count=0,
            axle_weights=[],
            gross_weight_t=0.0,
            quality="POOR",
            status="FAILED",
            scenario="device_offline",
            notes="WIM device communication timeout; sensor channel offline",
        )

    elif norm_scenario == "timeout":
        # Measurement timeout
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=0.0,
            axle_count=0,
            axle_weights=[],
            gross_weight_t=0.0,
            quality="POOR",
            status="TIMEOUT",
            scenario="timeout",
            notes="Vehicle presence detected on inductive loop but weight measurement timed out",
        )

    elif norm_scenario == "duplicate":
        # Duplicate measurement
        steer = 4.2
        drive = 7.5
        weights = [steer, drive]
        gross = calculate_gross_weight(weights)
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=15.0,
            axle_count=2,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="DUPLICATE",
            scenario="duplicate",
            notes="Duplicate transmission of existing measurement event frame",
        )

    else:
        # Default fallback: 2-axle normal
        weights = [4.2, 7.8]
        gross = calculate_gross_weight(weights)
        return SimulatedWimReading(
            measurement_id=next_measurement_id(),
            device_code=dev_code,
            gate=gate,
            lane=lane,
            direction=direction,
            observed_at=now,
            plate=plate,
            speed_kmh=15.0,
            axle_count=2,
            axle_weights=weights,
            gross_weight_t=gross,
            quality="GOOD",
            status="VALID",
            scenario="normal_2axle",
            notes="Standard simulated WIM measurement",
        )
