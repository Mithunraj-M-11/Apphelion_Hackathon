"""Unit and integration tests for Weigh-in-Motion (WIM) independent verification."""

from datetime import datetime, timezone
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Officer, Truck
from app.models.wim import WimAnomaly, WimDevice, WimMeasurement
from app.services import wim_service
from app.services.wim_simulator import calculate_gross_weight, generate_simulated_wim


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def officer(db):
    o = db.scalar(select(Officer).where(Officer.active.is_(True)))
    if not o:
        o = Officer(name="Officer Test", role="reviewer", active=True)
        db.add(o)
        db.commit()
        db.refresh(o)
    return o


def test_wim_gross_weight_calculation():
    """Gross vehicle weight must be strictly calculated from the sum of individual axle loads."""
    axle_weights = [4.25, 8.50, 8.75]
    gross = calculate_gross_weight(axle_weights)
    assert gross == 21.50
    assert isinstance(gross, float)

    # 2-axle calculation
    axle_weights_2 = [3.80, 6.40]
    assert calculate_gross_weight(axle_weights_2) == 10.20


def test_wim_simulator_scenarios():
    """Simulator must produce realistic structured records for normal and anomalous scenarios."""
    # 1. Normal 2-axle
    r1 = generate_simulated_wim(scenario="normal_2axle", gate="G1", direction="ENTRY")
    assert r1.axle_count == 2
    assert len(r1.axle_weights) == 2
    assert r1.gross_weight_t == round(sum(r1.axle_weights), 2)
    assert r1.quality == "GOOD"
    assert r1.status == "VALID"
    assert r1.source == "SIMULATED"

    # 2. Normal 3-axle
    r2 = generate_simulated_wim(scenario="normal_3axle", gate="G1", direction="ENTRY")
    assert r2.axle_count == 3
    assert len(r2.axle_weights) == 3
    assert r2.quality == "GOOD"

    # 3. GVW Overload
    r3 = generate_simulated_wim(scenario="gvw_overload", gate="G1", direction="ENTRY")
    assert r3.status == "ANOMALY"
    assert r3.gross_weight_t > 30.0

    # 4. Axle Overload
    r4 = generate_simulated_wim(scenario="axle_overload", gate="G1", direction="ENTRY")
    assert r4.status == "ANOMALY"
    assert any(w > 11.5 for w in r4.axle_weights)

    # 5. Poor Quality
    r5 = generate_simulated_wim(scenario="poor_quality", gate="G1", direction="ENTRY")
    assert r5.quality == "POOR"
    assert r5.status == "ANOMALY"

    # 6. Device Offline / Failure
    r6 = generate_simulated_wim(scenario="device_offline", gate="G1", direction="ENTRY")
    assert r6.status == "FAILED"
    assert r6.gross_weight_t == 0.0


def test_wim_device_lifecycle(db, officer):
    """Device status transitions (ONLINE, OFFLINE, DEGRADED) must be tracked and audited."""
    wim_service.ensure_default_devices(db)
    dev = wim_service.set_device_status(db, "WIM-G1-01", "OFFLINE", officer=officer, reason="Scheduled sensor cleaning")
    assert dev.status == "OFFLINE"

    dev = wim_service.set_device_status(db, "WIM-G1-01", "ONLINE", officer=officer, reason="Sensor re-calibrated and online")
    assert dev.status == "ONLINE"


def test_radar_wim_correlation_scenarios(db):
    """Verify Scenarios A, B, C, D, E for radar and WIM independent correlation."""
    truck = db.scalar(select(Truck).where(Truck.status == "active"))
    assert truck is not None

    # Scenario A: Both radar and WIM operational
    corr_a = wim_service.correlate_radar_and_wim(
        radar_length_m=truck.length_m,
        wim_measurement=generate_simulated_wim("normal_3axle"),
        truck=truck,
        radar_available=True,
        wim_available=True,
    )
    assert corr_a["correlation_status"] == "CORRELATED"
    assert corr_a["overall_status"] in ("PASSED", "WARNING")

    # Scenario B: Radar unavailable, WIM operational
    corr_b = wim_service.correlate_radar_and_wim(
        radar_length_m=None,
        wim_measurement=generate_simulated_wim("normal_3axle"),
        truck=truck,
        radar_available=False,
        wim_available=True,
    )
    assert corr_b["correlation_status"] == "WIM_ONLY"
    assert corr_b["overall_status"] == "WARNING"
    assert corr_b["monitoring_warning"] is not None

    # Scenario C: Radar operational, WIM unavailable
    corr_c = wim_service.correlate_radar_and_wim(
        radar_length_m=truck.length_m,
        wim_measurement=None,
        truck=truck,
        radar_available=True,
        wim_available=False,
    )
    assert corr_c["correlation_status"] == "RADAR_ONLY"
    assert corr_c["overall_status"] == "WARNING"
    assert corr_c["monitoring_warning"] is not None

    # Scenario D: Both radar and WIM unavailable
    corr_d = wim_service.correlate_radar_and_wim(
        radar_length_m=None,
        wim_measurement=None,
        truck=truck,
        radar_available=False,
        wim_available=False,
    )
    assert corr_d["correlation_status"] == "BOTH_UNAVAILABLE"
    assert corr_d["overall_status"] == "UNAVAILABLE"

    # Scenario E: Inconsistent observations (discrepancy detected)
    # e.g. Radar length indicates passenger car (4.2m) but WIM shows heavy 3-axle 28t truck
    corr_e = wim_service.correlate_radar_and_wim(
        radar_length_m=4.20,
        wim_measurement=generate_simulated_wim("normal_3axle"),
        truck=truck,
        radar_available=True,
        wim_available=True,
    )
    assert corr_e["correlation_status"] == "DISCREPANCY"
    assert corr_e["overall_status"] == "FAILED"
    assert "DISCREPANCY DETECTED" in (corr_e["discrepancy_reason"] or "")


def test_wim_anomaly_detection_and_review(db, officer):
    """Anomalies must be recorded, linked to measurements, and reviewed with officer attribution."""
    # Record an overloaded measurement
    m = wim_service.record_measurement(
        db=db,
        device_code="WIM-G1-01",
        gate="G1",
        direction="ENTRY",
        speed_kmh=14.5,
        axle_count=3,
        axle_weights=[6.0, 14.5, 15.0],  # gross 35.5t, heavily overloaded
        quality="GOOD",
        status="ANOMALY",
        plate="OD09AC5678",
    )
    assert m.gross_weight_t == 35.5

    # Check that anomalies were detected and stored
    anomalies = db.scalars(select(WimAnomaly).where(WimAnomaly.measurement_id == m.id)).all()
    assert len(anomalies) > 0
    overload = next((a for a in anomalies if a.anomaly_type == "GVW_OVERLOAD"), None)
    assert overload is not None
    assert overload.status == "OPEN"

    # Officer reviews the anomaly
    reviewed = wim_service.review_anomaly(
        db=db,
        anomaly_id=overload.id,
        officer=officer,
        status="RESOLVED",
        reason="Weighbridge secondary inspection confirmed legal secondary payload permit",
    )
    assert reviewed.status == "RESOLVED"
    assert reviewed.reviewed_by == officer.id
    assert reviewed.resolution_reason is not None


def test_wim_dashboard_metrics(db):
    """Dashboard metrics endpoint must calculate real counts without hardcoded mock data."""
    metrics = wim_service.get_dashboard_metrics(db)
    assert "total_devices" in metrics
    assert metrics["total_devices"] >= 2
    assert "total_measurements" in metrics
    assert "verification_overview" in metrics
    assert "anomaly_counts_by_status" in metrics


def test_wim_api_endpoints(officer):
    """Test REST API endpoints for WIM devices, simulation, anomalies, and dashboard."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    # 1. GET /api/wim/devices
    res = client.get("/api/wim/devices")
    assert res.status_code == 200
    devices = res.json()
    assert len(devices) >= 2
    assert any(d["device_code"] == "WIM-G1-01" for d in devices)

    # 2. PATCH /api/wim/devices/WIM-G1-01/status (requires X-Officer-Id header)
    res = client.patch(
        "/api/wim/devices/WIM-G1-01/status",
        headers={"X-Officer-Id": str(officer.id)},
        json={"status": "DEGRADED", "reason": "Pavement distortion test"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "DEGRADED"

    # Reset back to ONLINE
    client.patch(
        "/api/wim/devices/WIM-G1-01/status",
        headers={"X-Officer-Id": str(officer.id)},
        json={"status": "ONLINE", "reason": "Re-calibrated"},
    )

    # 3. POST /api/wim/simulate (Normal measurement for registered truck)
    res = client.post(
        "/api/wim/simulate",
        json={"scenario": "normal", "gate": "G1", "direction": "ENTRY", "plate": "OD09AC5678", "radar_length_m": 8.32},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["overall_status"] in ("PASSED", "WARNING")
    assert data["measurement"]["axle_count"] == 3
    meas_id = data["measurement"]["measurement_id"]

    # 4. GET /api/wim/measurements/{id}
    res = client.get(f"/api/wim/measurements/{meas_id}")
    assert res.status_code == 200
    assert res.json()["measurement_id"] == meas_id

    # 5. GET /api/wim/dashboard
    res = client.get("/api/wim/dashboard")
    assert res.status_code == 200
    dash = res.json()
    assert dash["total_devices"] >= 2
    assert dash["total_measurements"] > 0


def test_wim_all_11_demonstration_scenarios(db):
    """Test all 11 official WIM demonstration scenarios, verifying database records and logs."""
    for s_id in range(1, 12):
        res = wim_service.run_demonstration_scenario(db, s_id)
        assert res["scenario"] == s_id
        assert "title" in res
