"""Log bus publish/subscribe and the Identify log-line description (no database needed)."""

import asyncio
from datetime import datetime, timezone

from app.models import EventLog, Truck
from app.services import logbus
from app.services.identify import Reading, describe, evaluate

T1 = Truck(id=1, plate="OD09AB1234", fastag_tag_id="TAG1", fastag_chip_id="CHIP1", length_m=8.32)
T4 = Truck(id=4, plate="OD09AE4521", fastag_tag_id="TAG4", fastag_chip_id="CHIP4", length_m=8.3)


def _row(i: int, source: str) -> EventLog:
    return EventLog(id=i, at=datetime.now(timezone.utc), component="IDENTIFY", level="INFO",
                    message=f"line {i}", source=source)


def test_subscriber_only_gets_its_own_source():
    async def scenario():
        a = logbus.subscribe("walkthrough:a")
        b = logbus.subscribe("walkthrough:b")
        try:
            logbus.publish([_row(1, "walkthrough:a"), _row(2, "walkthrough:b"), _row(3, "sim:1:S1")])
            await asyncio.sleep(0)  # let call_soon_threadsafe callbacks run
            got_a = [a.queue.get_nowait()["id"] for _ in range(a.queue.qsize())]
            got_b = [b.queue.get_nowait()["id"] for _ in range(b.queue.qsize())]
            return got_a, got_b
        finally:
            logbus.unsubscribe(a)
            logbus.unsubscribe(b)

    got_a, got_b = asyncio.run(scenario())
    assert got_a == [1]
    assert got_b == [2]


def test_describe_logs_failed_checks_as_warn_and_result_as_alert():
    d = evaluate(Reading("OD09AB1234", "TAG4", 8.3), T1, T4, authorise=lambda t: {"authorised": True, "reasons": []})
    lines = describe(d)
    assert lines[-1].level == "ALERT" and "MISMATCH" in lines[-1].message
    warn = [l for l in lines if l.level == "WARN"]
    assert len(warn) == 1 and warn[0].context["check"] == "plate_fastag"
    assert all(l.component == "IDENTIFY" for l in lines)
