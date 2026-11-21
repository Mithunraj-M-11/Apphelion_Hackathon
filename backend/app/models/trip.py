"""Trip state: the permit (limits), GB-issued trip passes, truck holds, alerts, and the GB's server keys.

Every trip-state record belongs to a permit. Simulator scenarios and Gate console sessions each create their own
(source-tagged) permit, so they never interfere with each other or with the real permit, and never touch the
registry.
"""

from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, Time, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.registry import Truck

SEVERITIES = ("INFO", "MEDIUM", "HIGH", "CRITICAL")


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
    source: Mapped[str | None] = mapped_column(String(100), index=True)  # null = real permit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Pass(Base):
    """A trip pass: issued by the GB at entry (signed), closed at exit. Single use."""

    __tablename__ = "passes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # P-0001
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    entry_movement_id: Mapped[int] = mapped_column(ForeignKey("movements.id"))
    exit_movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"))
    entry_gate: Mapped[str] = mapped_column(String(20))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entry_weight_t: Mapped[float] = mapped_column(Float)
    entry_weight_measured: Mapped[bool] = mapped_column(default=True)  # False = enrolled empty weight (fallback)
    exit_weight_t: Mapped[float | None] = mapped_column(Float)
    net_t: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | closed
    close_mode: Mapped[str | None] = mapped_column(String(10))  # qr | sms | no_qr
    token: Mapped[str] = mapped_column(Text)  # signed QR content
    sms_code: Mapped[str] = mapped_column(String(8), index=True)
    flags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    source: Mapped[str | None] = mapped_column(String(100))

    truck: Mapped[Truck] = relationship()


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
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), index=True)
    pass_id: Mapped[int | None] = mapped_column(ForeignKey("passes.id"))
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"))
    code: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(10))  # INFO | MEDIUM | HIGH | CRITICAL
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(15), default="open")
    source: Mapped[str | None] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ServerKey(Base):
    """GB server secrets (pass-signing key, SMS-code secret), generated on first use. PoC: kept in the DB."""

    __tablename__ = "server_keys"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
