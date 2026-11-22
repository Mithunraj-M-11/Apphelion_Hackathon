"""Server log lines shown live in the dashboard (and kept for replay; later input to Record)."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

LEVELS = ("INFO", "WARN", "ALERT", "CRITICAL")


class EventLog(Base):
    __tablename__ = "event_logs"
    __mapper_args__ = {"eager_defaults": True}  # fetch the server timestamp on insert

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.clock_timestamp(), index=True)
    component: Mapped[str] = mapped_column(String(20))  # POLE | IDENTIFY | PASS | COMPARE | ACT | RECORD
    level: Mapped[str] = mapped_column(String(10))  # INFO | WARN | ALERT | CRITICAL
    message: Mapped[str] = mapped_column(Text)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("movements.id"), index=True)
    source: Mapped[str | None] = mapped_column(String(100), index=True)
    context: Mapped[dict | None] = mapped_column(JSONB)
