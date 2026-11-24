"""GB truck registry: the ground truth built from physical inspection (see docs/implementation/registry.md)."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Allowed values (validated in the API schemas)
OFFICER_ROLES = ("inspector", "approver", "reviewer")
TRUCK_STATUSES = ("active", "suspended", "on_hold", "retired")
PHOTO_KINDS = ("plate_front", "plate_rear", "side", "full")


class Officer(Base):
    """GB officer. No login in the PoC; the dashboard picks who is acting."""

    __tablename__ = "officers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Contract(Base):
    """The extraction contract / site a truck is assigned to."""

    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    vendor_name: Mapped[str] = mapped_column(String(200))
    site_name: Mapped[str] = mapped_column(String(200))
    mineral: Mapped[str | None] = mapped_column(String(100))


class Transporter(Base):
    """The party: transport company that owns / operates trucks."""

    __tablename__ = "transporters"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    address: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(15), unique=True)
    contact_person: Mapped[str | None] = mapped_column(String(100))
    contact_phone: Mapped[str | None] = mapped_column(String(20))
    # Registered numbers that receive trip passes (app + SMS)
    phone_numbers: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=list)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contract: Mapped[Contract | None] = relationship()
    drivers: Mapped[list["Driver"]] = relationship(back_populates="transporter", order_by="Driver.id")
    trucks: Mapped[list["Truck"]] = relationship(back_populates="transporter")


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(primary_key=True)
    transporter_id: Mapped[int] = mapped_column(ForeignKey("transporters.id"))
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20))
    licence_no: Mapped[str | None] = mapped_column(String(30))  # optional
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    transporter: Mapped[Transporter] = relationship(back_populates="drivers")


class Truck(Base):
    __tablename__ = "trucks"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Identity
    plate: Mapped[str] = mapped_column(String(15), unique=True, index=True)  # normalised, e.g. KA01AB1234
    plate_type: Mapped[str] = mapped_column(String(10))  # standard | bh
    fastag_tag_id: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    fastag_chip_id: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)

    # Physical
    length_m: Mapped[float] = mapped_column(Float)
    axle_count: Mapped[int | None] = mapped_column(Integer)
    # distance between consecutive axles, front to back (m): WIM measures it, so it is part of the body fingerprint
    axle_spacings_m: Mapped[list | None] = mapped_column(JSONB)
    make: Mapped[str | None] = mapped_column(String(50))
    model: Mapped[str | None] = mapped_column(String(50))
    body_type: Mapped[str | None] = mapped_column(String(30))
    colour: Mapped[str | None] = mapped_column(String(30))
    chassis_no: Mapped[str | None] = mapped_column(String(30), unique=True)
    engine_no: Mapped[str | None] = mapped_column(String(30))
    empty_weight_t: Mapped[float] = mapped_column(Float)
    rated_capacity_t: Mapped[float] = mapped_column(Float)
    gvw_t: Mapped[float | None] = mapped_column(Float)

    # Documents (from VAHAN)
    rc_valid_until: Mapped[date | None] = mapped_column(Date)
    fitness_valid_until: Mapped[date | None] = mapped_column(Date)
    insurance_valid_until: Mapped[date | None] = mapped_column(Date)
    permit_valid_until: Mapped[date | None] = mapped_column(Date)
    vahan_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    vahan_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Authorisation
    status: Mapped[str] = mapped_column(String(20), default="active")
    status_reason: Mapped[str | None] = mapped_column(Text)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)

    # Ownership
    transporter_id: Mapped[int] = mapped_column(ForeignKey("transporters.id"))
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id"))

    # Enrollment (maker-checker)
    inspected_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"))
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    inspection_location: Mapped[str | None] = mapped_column(String(200))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    transporter: Mapped[Transporter] = relationship(back_populates="trucks")
    contract: Mapped[Contract | None] = relationship()
    inspector: Mapped[Officer | None] = relationship(foreign_keys=[inspected_by])
    approver: Mapped[Officer | None] = relationship(foreign_keys=[approved_by])
    photos: Mapped[list["TruckPhoto"]] = relationship(back_populates="truck", order_by="TruckPhoto.id")


class TruckPhoto(Base):
    __tablename__ = "truck_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"))
    kind: Mapped[str] = mapped_column(String(20))
    file_path: Mapped[str] = mapped_column(String(300))  # relative to settings.upload_dir
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    truck: Mapped[Truck] = relationship(back_populates="photos")


class RegistryHistory(Base):
    """Append-only log of every registry change. Never updated or deleted."""

    __tablename__ = "registry_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(20))  # truck | transporter | driver
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(20))  # create | update | status | photo
    changed_by: Mapped[int] = mapped_column(ForeignKey("officers.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    officer: Mapped[Officer] = relationship()
