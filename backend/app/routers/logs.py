"""Server log lines: live stream (Server-Sent Events) and history for replay."""

import asyncio
import json

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EventLog
from app.services import logbus

router = APIRouter(prefix="/api/logs", tags=["logs"])

KEEPALIVE_S = 15


@router.get("")
def history(
    source: str | None = Query(None, description="Source prefix, e.g. 'walkthrough:ab12cd34' or 'sim:3:'"),
    movement_id: int | None = None,
    limit: int = Query(300, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Most recent log lines (oldest first), optionally for one source or gate event."""
    stmt = select(EventLog).order_by(EventLog.id.desc()).limit(limit)
    if source:
        stmt = stmt.where(EventLog.source.startswith(source))
    if movement_id is not None:
        stmt = stmt.where(EventLog.movement_id == movement_id)
    return [logbus.to_dict(r) for r in reversed(db.scalars(stmt).all())]


@router.get("/stream")
async def stream(request: Request, source: str | None = Query(None, description="Source prefix to follow")):
    """Live log lines as Server-Sent Events. One JSON object per event; comment pings keep the connection open."""
    sub = logbus.subscribe(source)

    async def events():
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(sub.queue.get(), timeout=KEEPALIVE_S)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"id: {item['id']}\ndata: {json.dumps(item)}\n\n"
        finally:
            logbus.unsubscribe(sub)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
