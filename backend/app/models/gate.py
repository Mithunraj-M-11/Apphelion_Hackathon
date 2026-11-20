"""Gate events (what the GB poles observed) and simulator scenario runs."""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.registry import Truck

RESULTS = ("AUTHORISED", "NOT_AUTHORISED", "UNREGISTERED", "UNIDENTIFIED", "MISMATCH")


class Movement(Base):
    """One vehicle seen at a gate: raw sensor readings + the Identify decision."""

    __tablename__ = "movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    gate: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[str] = mapped_column(String(3))  # IN | OUT
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Raw sensor readings (as reported by the pole)
    plate_read: Mapped[str | None] = mapped_column(String(30))
    plate_normalised: Mapped[str | None] = mapped_column(String(30))
    fastag_read: Mapped[str | None] = mapped_column(String(40))
    radar_length_m: Mapped[float | None] = mapped_column(Float)

    # Identify decision
    result: Mapped[str] = mapped_column(String(20), index=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"))
    identify_mode: Mapped[str] = mapped_column(String(20))
    checks: Mapped[list] = mapped_column(JSONB)  # [{name, status, detail}]
    caught_by: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    reasons: Mapped[list[str]] = mapped_column(ARRAY(String(300)), default=list)
    flags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)

    source: Mapped[str | None] = mapped_column(String(100), index=True)  # e.g. sim:12:S3

    truck: Mapped[Truck | None] = relationship()


class SimRun(Base):
    """One run of a simulator scenario suite and its scorecard."""

    __tablename__ = "sim_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    suite: Mapped[str] = mapped_column(String(100))
    identify_mode: Mapped[str | None] = mapped_column(String(20))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    tamper_total: Mapped[int] = mapped_column(Integer, default=0)
    tamper_caught: Mapped[int] = mapped_column(Integer, default=0)
    honest_total: Mapped[int] = mapped_column(Integer, default=0)
    false_alarms: Mapped[int] = mapped_column(Integer, default=0)
    results: Mapped[list] = mapped_column(JSONB, default=list)  # per-scenario detail
