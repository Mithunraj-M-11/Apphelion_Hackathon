"""Gate events (what the GB poles observed) and simulator scenario runs."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
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
    rfid_sticker_uid: Mapped[str | None] = mapped_column(String(50))  # GB RFID sticker read

    # Identify decision
    result: Mapped[str] = mapped_column(String(20), index=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"))
    identify_mode: Mapped[str] = mapped_column(String(20))
    checks: Mapped[list] = mapped_column(JSONB)  # [{name, status, detail}]
    caught_by: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    reasons: Mapped[list[str]] = mapped_column(ARRAY(String(300)), default=list)
    flags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)

    source: Mapped[str | None] = mapped_column(String(100), index=True)  # e.g. sim:12:S3

    # Trip decision (entry: pass issued or refused; exit: pass closed or refused)
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"), index=True)
    weight_t: Mapped[float | None] = mapped_column(Float)  # GB weigh pad reading
    pass_id: Mapped[int | None] = mapped_column(
        ForeignKey("trip_sessions.id", use_alter=True, name="fk_movements_pass_id")
    )  # the trip session (pass) issued or closed by this movement
    decision: Mapped[str | None] = mapped_column(String(10))  # ALLOWED | REFUSED
    barrier: Mapped[str | None] = mapped_column(String(5))  # up | down
    barrier_forced: Mapped[bool] = mapped_column(Boolean, default=False)
    counted_trip: Mapped[bool] = mapped_column(Boolean, default=False)  # heavy vehicle crossed the exit
    trip: Mapped[str | None] = mapped_column(String(10))  # LEGAL | ILLEGAL (exits only)
    steps: Mapped[list | None] = mapped_column(JSONB)  # [{name, status, items: [{label, status, detail}]}]

    truck: Mapped[Truck | None] = relationship()
    pass_: Mapped["TripSession | None"] = relationship(foreign_keys=[pass_id])  # noqa: F821
    alerts: Mapped[list["Alert"]] = relationship(  # noqa: F821
        primaryjoin="Movement.id == Alert.movement_id", foreign_keys="Alert.movement_id", order_by="Alert.id",
        viewonly=True,
    )


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


class SiteRun(Base):
    """One site-level simulation: a whole contract period replayed through the gates, with its report."""

    __tablename__ = "site_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    scenario: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(500))
    seed: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    permit_id: Mapped[int | None] = mapped_column(ForeignKey("permits.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    report: Mapped[dict | None] = mapped_column(JSONB)
