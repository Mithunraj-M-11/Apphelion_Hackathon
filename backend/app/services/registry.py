"""Registry business rules: every change writes an append-only history row."""

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import Officer, RegistryHistory, Truck

DOCUMENTS = (
    ("rc_valid_until", "Registration (RC)"),
    ("fitness_valid_until", "Fitness certificate"),
    ("insurance_valid_until", "Insurance"),
    ("permit_valid_until", "Permit"),
)


def _jsonable(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def snapshot(obj: Any) -> dict:
    """All column values of a model instance, JSON-safe (for history before/after)."""
    return {c.name: _jsonable(getattr(obj, c.name)) for c in obj.__table__.columns}


def record_history(
    db: Session,
    *,
    entity: str,
    entity_id: int,
    action: str,
    officer: Officer,
    reason: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    db.add(
        RegistryHistory(
            entity=entity,
            entity_id=entity_id,
            action=action,
            changed_by=officer.id,
            reason=reason,
            before=before,
            after=after,
        )
    )


def diff(before: dict, after: dict) -> tuple[dict, dict]:
    """Keep only the fields that changed (ignoring timestamps)."""
    skip = {"updated_at", "created_at"}
    changed = [k for k in after if k not in skip and before.get(k) != after.get(k)]
    return {k: before.get(k) for k in changed}, {k: after.get(k) for k in changed}


def compute_authorisation(truck: Truck, today: date | None = None) -> dict:
    """Is this truck allowed to work today? Computed, never stored, so expiries take effect automatically."""
    today = today or datetime.now(timezone.utc).date()
    reasons: list[str] = []
    if truck.status != "active":
        reasons.append(f"Status is {truck.status.replace('_', ' ')}")
    if truck.valid_from and today < truck.valid_from:
        reasons.append(f"Not valid until {truck.valid_from.isoformat()}")
    if truck.valid_to and today > truck.valid_to:
        reasons.append(f"Enrollment ended on {truck.valid_to.isoformat()}")
    for field, label in DOCUMENTS:
        expiry = getattr(truck, field)
        if expiry is None:
            reasons.append(f"{label}: date missing")
        elif expiry < today:
            reasons.append(f"{label} expired on {expiry.isoformat()}")
    if not truck.vahan_verified:
        reasons.append("Not verified with VAHAN")
    return {"authorised": not reasons, "reasons": reasons}
