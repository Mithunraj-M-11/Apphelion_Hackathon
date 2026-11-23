"""Volume surveys (mass balance): what the ground says was dug, against what the GB's gates weighed out."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Survey(Base):
    """One survey of a permit's site over a period (weekly RTK drone photogrammetry; monthly LiDAR; quarterly
    satellite). Ore that left = volume dug x in-situ density - increase in ore stockpiles; compared with the tonnes the
    GB weighed out through its gates in the same period."""

    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(primary_key=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id"), index=True)
    period_from: Mapped[date] = mapped_column(Date)
    period_to: Mapped[date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(40))  # drone_photogrammetry | drone_lidar | satellite_stereo
    volume_dug_m3: Mapped[float] = mapped_column(Float)  # ore zone, from the two terrain models
    density_t_m3: Mapped[float] = mapped_column(Float)  # in-situ, GB-verified
    stockpile_change_t: Mapped[float] = mapped_column(Float, default=0.0)  # + = ore piled up on site, not hauled
    outside_plan_m3: Mapped[float] = mapped_column(Float, default=0.0)  # dug outside the approved boundary / depth
    check_error_cm: Mapped[float | None] = mapped_column(Float)  # height error on the GB's check pillars
    status: Mapped[str] = mapped_column(String(20))  # accepted | rejected (check error too large)
    surveyed_out_t: Mapped[float | None] = mapped_column(Float)  # ore that left the site, by the survey
    gates_out_t: Mapped[float | None] = mapped_column(Float)  # ore the GB's gates weighed out in the period
    gap_pct: Mapped[float | None] = mapped_column(Float)  # (survey - gates) / gates x 100
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("officers.id"))
    source: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
