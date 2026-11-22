"""Officer actions at the gate: let a refused truck out on its own pass, never while it is on hold, and the
evidence shown for releasing a clone hold. Uses the helpers and test permits of test_rfid_and_trips."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Officer, TruckHold
from app.routers.gates import officer_exit
from app.routers.permits import release_hold
from app.schemas import HoldRelease, OfficerActionIn
from app.services import trip
from tests.test_rfid_and_trips import _event, _permit, codes, db_session  # noqa: F401  (fixture)


def _officer(db: Session) -> Officer:
    return db.scalar(select(Officer).where(Officer.active.is_(True)).order_by(Officer.id))


def test_officer_lets_out_a_truck_with_an_expired_pass(db_session: Session):
    p = _permit(db_session)
    entry = _event(db_session, p, "OD09AH2468", "IN")
    refused = _event(db_session, p, "OD09AH2468", "OUT", minutes=150, token=entry.issued_pass.token, load_t=20)
    assert refused.barrier == "down" and "PASS_EXPIRED_AT_EXIT" in codes(refused)

    out = officer_exit(refused.id, OfficerActionIn(reason="Pass expired in a queue at the face"), db_session,
                       _officer(db_session))
    assert out.barrier == "up" and out.trip == "LEGAL" and "OFFICER_EXIT" in codes(out)
    assert out.trip_session.status == "COMPLETED" and out.trip_session.close_mode == "officer"
    assert out.trip_session.net_t is not None
    led = trip.ledger(db_session, p)
    assert led["legal_trips"] == 1 and led["actual_trips"] == 1 and led["unresolved_passes"] == 0

    with pytest.raises(HTTPException) as again:  # one refused exit, one officer action
        officer_exit(refused.id, OfficerActionIn(reason="again"), db_session, _officer(db_session))
    assert again.value.status_code == 409


def test_officer_exit_waits_for_the_hold_to_be_released(db_session: Session):
    p = _permit(db_session)
    entry = _event(db_session, p, "OD09AC5678", "IN")
    refused = _event(db_session, p, "OD09AC5678", "OUT", minutes=40, mode="cloned", token=entry.issued_pass.token,
                     load_t=20)
    assert refused.barrier == "down" and "RFID_CLONED" in codes(refused)
    officer = _officer(db_session)
    with pytest.raises(HTTPException) as held:
        officer_exit(refused.id, OfficerActionIn(reason="Checked in person"), db_session, officer)
    assert held.value.status_code == 409 and "release the hold" in held.value.detail

    hold = db_session.scalar(select(TruckHold).where(TruckHold.permit_id == p.id, TruckHold.released_at.is_(None)))
    release_hold(hold.id, HoldRelease(reason="Sticker re-read in person, chassis number matches"), db_session, officer)
    out = officer_exit(refused.id, OfficerActionIn(reason="Checked in person"), db_session, officer)
    assert out.barrier == "up" and out.trip_session.close_mode == "officer"


def test_officer_exit_needs_an_open_pass(db_session: Session):
    p = _permit(db_session)
    refused = _event(db_session, p, "OD09AB1234", "OUT", minutes=5, load_t=20)  # never entered through a gate
    assert refused.barrier == "down" and "NO_PASS" in codes(refused)
    with pytest.raises(HTTPException) as no_pass:
        officer_exit(refused.id, OfficerActionIn(reason="Driver says QR lost"), db_session, _officer(db_session))
    assert no_pass.value.status_code == 409 and "no open pass" in no_pass.value.detail


def test_clone_hold_shows_the_genuine_sticker_as_evidence(db_session: Session):
    p = _permit(db_session)
    _event(db_session, p, "OD09AE4521", "IN", mode="cloned")  # a clone is held
    genuine = _event(db_session, p, "OD09AE4521", "IN", minutes=10)
    assert "TRUCK_ON_HOLD" in codes(genuine)
    items = [i for s in genuine.steps for i in s.items]
    assert any(i.label == "GB sticker on this read" and i.status == "info" for i in items)
