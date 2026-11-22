"""Edge infrastructure, failover state, disaster recovery, and synchronization outbox."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.gate import Movement
from app.models.registry import Officer


class SyncOutbox(Base):
    """Synchronization-ready outbox for future central GB synchronization."""

    __tablename__ = "sync_outbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EdgeSystemState(Base):
    """Singleton tracking local edge device state, failover authority, and WAN status."""

    __tablename__ = "edge_system_state"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    active_authority: Mapped[str] = mapped_column(String(30), default="PRIMARY")  # PRIMARY | STANDBY | EMERGENCY
    primary_status: Mapped[str] = mapped_column(String(30), default="ACTIVE")    # ACTIVE | FAILED | OFFLINE
    standby_status: Mapped[str] = mapped_column(String(30), default="STANDBY")  # STANDBY | ACTIVE | OFFLINE
    wan_connectivity: Mapped[str] = mapped_column(
        String(50), default="ONLINE"
    )  # ONLINE | WAN_OFFLINE_LOCAL_OPERATIONAL | LOCAL_DATA_STALE | LOCAL_AUTHORITY_UNAVAILABLE
    disaster_recovery_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    last_heartbeat: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_replication: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_snapshot_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EmergencyMovement(Base):
    """Authorized movements recorded during emergency or disaster recovery mode for later reconciliation."""

    __tablename__ = "emergency_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), nullable=True)
    truck_plate: Mapped[str] = mapped_column(String(30))
    direction: Mapped[str] = mapped_column(String(10))
    gate: Mapped[str] = mapped_column(String(20))
    officer_id: Mapped[int] = mapped_column(ForeignKey("officers.id"))
    reason: Mapped[str] = mapped_column(Text)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reconciliation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    movement: Mapped[Movement | None] = relationship()
    officer: Mapped[Officer] = relationship()
