"""GB-issued RFID stickers: physical tags bound to trucks for gate authentication."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.registry import Officer, Truck

STICKER_STATUSES = ("ACTIVE", "DAMAGED", "REVOKED", "EXPIRED", "REPLACED")


class RfidSticker(Base):
    __tablename__ = "rfid_stickers"

    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    truck_id: Mapped[int] = mapped_column(ForeignKey("trucks.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    auth_key_hash: Mapped[str] = mapped_column(String(64))  # for simulated challenge-response
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    issued_by: Mapped[int] = mapped_column(ForeignKey("officers.id"))

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[int | None] = mapped_column(ForeignKey("officers.id"), nullable=True)
    revocation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    replaced_by_sticker_id: Mapped[int | None] = mapped_column(ForeignKey("rfid_stickers.id"), nullable=True)

    truck: Mapped[Truck] = relationship()
    issuer: Mapped[Officer] = relationship(foreign_keys=[issued_by])
    revoker: Mapped[Officer | None] = relationship(foreign_keys=[revoked_by])
