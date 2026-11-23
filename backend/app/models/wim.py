"""Weigh-in-Motion (WIM) models: independent weight-observation source for gate verification."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class WimDevice(Base):
    """Simulated GB-owned Weigh-in-Motion sensor installation at a gate lane."""

    __tablename__ = "wim_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_code: Mapped[str] = mapped_column(String(30), unique=True, index=True)  # e.g. WIM-G1-01
    gate: Mapped[str] = mapped_column(String(20), index=True)  # e.g. G1, G2
    lane: Mapped[str] = mapped_column(String(20))  # e.g. ENTRY-1, EXIT-1
    status: Mapped[str] = mapped_column(String(20), default="ONLINE", index=True)  # ONLINE | OFFLINE | DEGRADED
    model: Mapped[str] = mapped_column(String(50), default="GB-WIM-Dynamic-40T")
    firmware_version: Mapped[str] = mapped_column(String(30), default="v2.4.1")
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    measurements: Mapped[list["WimMeasurement"]] = relationship(back_populates="device", order_by="WimMeasurement.id.desc()")


class WimMeasurement(Base):
    """One dynamic vehicle weight measurement recorded by a WIM sensor."""

    __tablename__ = "wim_measurements"

    id: Mapped[int] = mapped_column(primary_key=True)
    measurement_id: Mapped[str] = mapped_column(String(30), unique=True, index=True)  # e.g. WIM-000101
    device_id: Mapped[int | None] = mapped_column(ForeignKey("wim_devices.id"), index=True)
    device_code: Mapped[str] = mapped_column(String(30), index=True)
    gate: Mapped[str] = mapped_column(String(20), index=True)
    lane: Mapped[str] = mapped_column(String(20))
    direction: Mapped[str] = mapped_column(String(10))  # ENTRY | EXIT | IN | OUT
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Vehicle identification association (from existing ANPR, FASTag, GB RFID)
    plate: Mapped[str | None] = mapped_column(String(30), index=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"), index=True)

    # Dynamic weight measurements
    speed_kmh: Mapped[float] = mapped_column(Float)  # e.g. 14.5 km/h
    axle_count: Mapped[int] = mapped_column(Integer)  # e.g. 2, 3, 4
    axle_weights: Mapped[list] = mapped_column(JSONB)  # e.g. [4.2, 5.0, 5.0] in tonnes
    gross_weight_t: Mapped[float] = mapped_column(Float)  # sum of axle_weights in tonnes

    # Measurement quality and status
    quality: Mapped[str] = mapped_column(String(20), default="GOOD")  # GOOD | FAIR | POOR
    status: Mapped[str] = mapped_column(String(30), default="VALID", index=True)  # VALID | ANOMALY | FAILED | TIMEOUT | UNMATCHED | DUPLICATE
    source: Mapped[str] = mapped_column(String(100), default="SIMULATED")

    # Link to movement (gate event) if correlated
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), index=True)
    radar_length_m: Mapped[float | None] = mapped_column(Float)  # radar length at the same gate event (if present)
    correlation_status: Mapped[str] = mapped_column(
        String(30), default="CORRELATED", index=True
    )  # CORRELATED | DISCREPANCY | RADAR_ONLY | WIM_ONLY | BOTH_UNAVAILABLE | UNMATCHED
    discrepancy_details: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    device: Mapped[WimDevice | None] = relationship(back_populates="measurements")
    truck: Mapped["Truck | None"] = relationship()  # noqa: F821
    movement: Mapped["Movement | None"] = relationship()  # noqa: F821
    anomalies: Mapped[list["WimAnomaly"]] = relationship(back_populates="measurement", order_by="WimAnomaly.id.desc()")


class WimAnomaly(Base):
    """Anomalies detected during WIM measurement or radar/WIM cross-check."""

    __tablename__ = "wim_anomalies"

    id: Mapped[int] = mapped_column(primary_key=True)
    anomaly_code: Mapped[str] = mapped_column(String(30), unique=True, index=True)  # e.g. ANO-WIM-000101
    measurement_id: Mapped[int | None] = mapped_column(ForeignKey("wim_measurements.id"), index=True)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), index=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"), index=True)
    plate: Mapped[str | None] = mapped_column(String(30), index=True)

    anomaly_type: Mapped[str] = mapped_column(
        String(50), index=True
    )  # GVW_OVERLOAD | AXLE_OVERLOAD | AXLE_IMBALANCE | POOR_QUALITY | INCOMPLETE_MEASUREMENT | AXLE_COUNT_MISMATCH | DUPLICATE_MEASUREMENT | UNMATCHED_VEHICLE | DEVICE_UNAVAILABLE | DISCREPANCY_DETECTED | OUTSIDE_WINDOW

    severity: Mapped[str] = mapped_column(String(20), default="MEDIUM", index=True)  # INFO | LOW | MEDIUM | HIGH | CRITICAL
    description: Mapped[str] = mapped_column(Text)
    details: Mapped[dict | None] = mapped_column(JSONB)

    # Review workflow (officer attribution required)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)  # OPEN | UNDER_REVIEW | RESOLVED | DISMISSED
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_reason: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    measurement: Mapped[WimMeasurement | None] = relationship(back_populates="anomalies")
    movement: Mapped["Movement | None"] = relationship()  # noqa: F821
    truck: Mapped["Truck | None"] = relationship()  # noqa: F821
    reviewer: Mapped["Officer | None"] = relationship()  # noqa: F821
