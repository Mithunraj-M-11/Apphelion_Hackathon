"""Log bus: pipeline steps write human-readable log lines; the dashboard watches them live (SSE).

Lines are saved (for replay, and later as input to the Record step) and published to in-process subscribers.
One backend process in the PoC, so in-memory pub/sub is enough. Publishing happens after the DB commit, from the
request's worker thread, so it hands items to each subscriber's event loop thread-safely.

Usage in a route:
    lines = [LogLine("POLE", "INFO", "..."), ...]
    rows = save(db, lines, source=..., movement_id=...)
    db.commit()
    publish(rows)
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import EventLog


@dataclass
class LogLine:
    component: str
    level: str  # INFO | WARN | ALERT | CRITICAL
    message: str
    context: dict | None = None


def to_dict(row: EventLog) -> dict:
    return {
        "id": row.id,
        "at": row.at.isoformat() if isinstance(row.at, datetime) else row.at,
        "component": row.component,
        "level": row.level,
        "message": row.message,
        "movement_id": row.movement_id,
        "source": row.source,
        "context": row.context,
    }


def save(db: Session, lines: list[LogLine], *, source: str | None, movement_id: int | None = None) -> list[EventLog]:
    rows = [
        EventLog(component=l.component, level=l.level, message=l.message, context=l.context,
                 source=source, movement_id=movement_id)
        for l in lines
    ]
    db.add_all(rows)
    db.flush()
    return rows


# ---------------------------------------------------------------- live subscribers
class _Subscriber:
    def __init__(self, loop: asyncio.AbstractEventLoop, source_prefix: str | None):
        self.loop = loop
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
        self.source_prefix = source_prefix

    def wants(self, item: dict) -> bool:
        return self.source_prefix is None or (item.get("source") or "").startswith(self.source_prefix)

    def offer(self, item: dict) -> None:
        if self.queue.full():  # slow client: drop rather than block the pipeline
            return
        self.queue.put_nowait(item)


_subscribers: set[_Subscriber] = set()


def subscribe(source_prefix: str | None) -> _Subscriber:
    sub = _Subscriber(asyncio.get_running_loop(), source_prefix)
    _subscribers.add(sub)
    return sub


def unsubscribe(sub: _Subscriber) -> None:
    _subscribers.discard(sub)


def publish(rows: list[EventLog]) -> None:
    """Send committed rows to every interested subscriber (safe to call from a worker thread)."""
    items = [to_dict(r) for r in rows]
    for sub in list(_subscribers):
        for item in items:
            if sub.wants(item):
                try:
                    sub.loop.call_soon_threadsafe(sub.offer, item)
                except RuntimeError:  # subscriber's loop closed
                    _subscribers.discard(sub)
