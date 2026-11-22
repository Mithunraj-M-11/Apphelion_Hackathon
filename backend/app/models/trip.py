"""Trip quota, trip sessions, and quota adjustment models."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.gate import Movement
from app.models.registry import Officer, Truck
from app.models.rfid import RfidSticker

SESSION_STATUSES = (
    "AWAITING_ENTRY_CONFIRMATION",
    "ACTIVE",
    "COMPLETED",
    "EXPIRED_UNRESOLVED",
    "FLAGGED",
    "CANCELLED",
)

QUOTA_STATUSES = ("AVAILABLE", "LOW", "EXHAUSTED", "EXPIRED")


class VehicleQuota(Base):
    __tablename__ = "vehicle_quotas"

    id: Mapped[int] = mapped_column(primary_key=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), unique=True, index=True)
    max_trips: Mapped[int] = mapped_column(Integer, default=100)
    completed_trips: Mapped[int] = mapped_column(Integer, default=0)
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
    """Lifecycle of a single authorized entry-to-exit trip."""

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

    truck: Mapped[Truck] = relationship()
    sticker: Mapped[RfidSticker] = relationship()
    entry_movement: Mapped[Movement | None] = relationship(foreign_keys=[entry_movement_id])
    exit_movement: Mapped[Movement | None] = relationship(foreign_keys=[exit_movement_id])
    creator: Mapped[Officer | None] = relationship(foreign_keys=[created_by])
    closer: Mapped[Officer | None] = relationship(foreign_keys=[closed_by])
