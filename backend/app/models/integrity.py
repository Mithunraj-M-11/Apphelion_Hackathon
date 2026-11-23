"""Integrity of the GB's own equipment and records: pole liveness (heartbeat) and the hash chain over gate events."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PoleState(Base):
    """The last sign of life from a gate pole (heartbeat or gate event), per data source so simulations stay apart.
    A silence longer than the allowed gap is reported as POLE_SILENT when the pole is heard again."""

    __tablename__ = "pole_states"
    __table_args__ = (UniqueConstraint("gate", "source", name="uq_pole_state_gate_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    gate: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(100), default="")  # "" = real poles
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # pole time of the latest signal
    sends_heartbeats: Mapped[bool] = mapped_column(Boolean, default=False)  # silence is only judged for these poles
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RecordEntry(Base):
    """One link of the hash chain (Record). Each gate event gets a digest of its fields at the time it was decided,
    chained to the previous link of the same permit: editing or deleting a stored event breaks the chain."""

    __tablename__ = "record_chain"

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    movement_id: Mapped[int] = mapped_column(Integer)  # not a foreign key: the link must survive a deleted row
    digest: Mapped[str] = mapped_column(String(64))  # sha256 of the event's fields
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))  # sha256(prev_hash + digest)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
