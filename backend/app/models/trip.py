"""Trip state: the permit (contract limits), trip sessions (the GB trip pass), per-vehicle allocations, holds,
alerts, Vendor reports and the GB's server keys.

Every trip-state record belongs to a permit. Simulator scenarios, Gate console sessions and site runs each create
their own (source-tagged) permit, so they never interfere with each other or with the real permit, and never touch
the registry.
"""

from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.gate import Movement
from app.models.registry import Officer, Truck
from app.models.rfid import RfidSticker

SEVERITIES = ("INFO", "MEDIUM", "HIGH", "CRITICAL")

SESSION_STATUSES = (
    "AWAITING_ENTRY_CONFIRMATION",
    "ACTIVE",
    "COMPLETED",
    "EXPIRED_UNRESOLVED",
    "FLAGGED",
    "CANCELLED",
)
OPEN_STATUSES = ("ACTIVE",)  # a pass that can still be closed at an exit
UNRESOLVED_STATUSES = ("EXPIRED_UNRESOLVED", "FLAGGED")  # need an officer before the truck gets a new pass

QUOTA_STATUSES = ("AVAILABLE", "LOW", "EXHAUSTED", "EXPIRED")


class Permit(Base):
    """What the contract allows: entered by the GB once per contract (or per sim scenario / console session)."""

    __tablename__ = "permits"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id"))
    label: Mapped[str] = mapped_column(String(200))
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date] = mapped_column(Date)
    trip_limit: Mapped[int] = mapped_column(Integer)
    tonne_limit: Mapped[float] = mapped_column(Float)
    vehicle_limit: Mapped[int] = mapped_column(Integer)
    hours_start: Mapped[time] = mapped_column(Time)  # site local time (IST)
    hours_end: Mapped[time] = mapped_column(Time)
    exit_grace_min: Mapped[int] = mapped_column(Integer, default=30)
    pass_expiry_min: Mapped[int] = mapped_column(Integer, default=120)
    per_vehicle_trips: Mapped[int | None] = mapped_column(Integer)  # contract cap per truck, if any
    source: Mapped[str | None] = mapped_column(String(100), index=True)  # null = real permit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VehicleQuota(Base):
    """Per-vehicle trip allocation under a permit. Exists only when the contract caps trips per truck."""

    __tablename__ = "vehicle_quotas"
    __table_args__ = (UniqueConstraint("permit_id", "truck_id", name="uq_vehicle_quotas_permit_truck"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"), index=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    max_trips: Mapped[int] = mapped_column(Integer, default=100)
    completed_trips: Mapped[int] = mapped_column(Integer, default=0)  # trips reserved (passes issued) so far
    remaining_trips: Mapped[int] = mapped_column(Integer, default=100)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="AVAILABLE", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    truck: Mapped[Truck] = relationship()


class QuotaAdjustment(Base):
    """Audit log of authorized quota adjustments."""

    __tablename__ = "quota_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    officer_id: Mapped[int] = mapped_column(ForeignKey("officers.id"))
    previous_max: Mapped[int] = mapped_column(Integer)
    new_max: Mapped[int] = mapped_column(Integer)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    truck: Mapped[Truck] = relationship()
    officer: Mapped[Officer] = relationship()


class TripSession(Base):
    """The GB trip pass: one authorized entry-to-exit trip. Issued at entry (signed QR + SMS code, bound to the
    truck and its GB RFID sticker), closed once at an exit with the measured net tonnes. Single use."""

    __tablename__ = "trip_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    trip_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    sticker_id: Mapped[int] = mapped_column(ForeignKey("rfid_stickers.id"), index=True)
    signed_token: Mapped[str] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)

    entry_gate: Mapped[str] = mapped_column(String(20))
    exit_gate: Mapped[str | None] = mapped_column(String(20), nullable=True)

    entry_movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), nullable=True)
    exit_movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True)
    entry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"), nullable=True)
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Measurement, permit and close details (unified pipeline)
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"), index=True)
    entry_weight_t: Mapped[float | None] = mapped_column(Float)
    entry_weight_measured: Mapped[bool] = mapped_column(Boolean, default=True)
    exit_weight_t: Mapped[float | None] = mapped_column(Float)
    net_t: Mapped[float | None] = mapped_column(Float)
    sms_code: Mapped[str | None] = mapped_column(String(8), index=True)
    close_mode: Mapped[str | None] = mapped_column(String(10))  # qr | sms | no_qr | officer
    flags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    source: Mapped[str | None] = mapped_column(String(100), index=True)

    truck: Mapped[Truck] = relationship()
    sticker: Mapped[RfidSticker] = relationship()
    entry_movement: Mapped[Movement | None] = relationship(foreign_keys=[entry_movement_id])
    exit_movement: Mapped[Movement | None] = relationship(foreign_keys=[exit_movement_id])
    creator: Mapped[Officer | None] = relationship(foreign_keys=[created_by])
    closer: Mapped[Officer | None] = relationship(foreign_keys=[closed_by])

    # names the pipeline and our schemas use
    @property
    def code(self) -> str:
        return self.trip_code

    @property
    def token(self) -> str:
        return self.signed_token

    @property
    def issued_at(self) -> datetime:
        return self.entry_at

    @property
    def closed_at(self) -> datetime | None:
        return self.completed_at


class TruckHold(Base):
    """A truck frozen pending officer review (clone suspicion, pass misuse). Released with a reason, never deleted."""

    __tablename__ = "truck_holds"

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    reason_code: Mapped[str] = mapped_column(String(40))
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"))
    release_reason: Mapped[str | None] = mapped_column(Text)

    truck: Mapped[Truck] = relationship()


class Alert(Base):
    """Something the GB must see. Closed with a reason later; never deleted."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"), index=True)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), index=True)
    pass_id: Mapped[int | None] = mapped_column(ForeignKey("trip_sessions.id"))
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"))
    code: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(10))  # INFO | MEDIUM | HIGH | CRITICAL
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(15), default="open")
    source: Mapped[str | None] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VendorReport(Base):
    """What the Vendor claims it moved on one day. Compared with the GB's own figures, never used as the source."""

    __tablename__ = "vendor_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    trips: Mapped[int] = mapped_column(Integer)
    tonnes: Mapped[float] = mapped_column(Float)
    source: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ServerKey(Base):
    """GB server secrets (pass-signing key, SMS-code secret), generated on first use. PoC: kept in the DB."""

    __tablename__ = "server_keys"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
