"""Identify decision logic on the 5 basic tampering scenario shapes (no database needed)."""

from app.models import Truck
from app.services.identify import Reading, evaluate

AUTH_OK = lambda t: {"authorised": True, "reasons": []}  # noqa: E731
AUTH_NO = lambda t: {"authorised": False, "reasons": ["Status is suspended"]}  # noqa: E731

T1 = Truck(id=1, plate="OD09AB1234", fastag_tag_id="TAG1", fastag_chip_id="CHIP1", length_m=8.32)
T2 = Truck(id=2, plate="OD09AC5678", fastag_tag_id="TAG2", fastag_chip_id="CHIP2", length_m=8.2)
T4 = Truck(id=4, plate="OD09AE4521", fastag_tag_id="TAG4", fastag_chip_id="CHIP4", length_m=8.3)


def test_s1_honest_trip_is_authorised_without_flags():
    d = evaluate(Reading("OD09AC5678", "TAG2", 8.2), T2, T2, authorise=AUTH_OK)
    assert d.result == "AUTHORISED"
    assert d.caught_by == [] and d.flags == []
    assert d.truck is T2


def test_s2_unregistered_plate():
    d = evaluate(Reading("OD09ZX7781", None, 8.1), None, None, authorise=AUTH_OK)
    assert d.result == "UNREGISTERED"
    assert "registry" in d.caught_by and "fastag_present" in d.caught_by


def test_s3_fake_plate_no_tag_caught_by_length():
    d = evaluate(Reading("OD09AB1234", None, 9.7), T1, None, authorise=AUTH_OK)
    assert d.result == "MISMATCH"
    assert "length" in d.caught_by and "fastag_present" in d.caught_by
    assert "POSSIBLE_CLONE" in d.flags


def test_s4_fake_plate_stolen_tag_caught_only_by_plate_fastag():
    d = evaluate(Reading("OD09AB1234", "TAG4", 8.3), T1, T4, authorise=AUTH_OK)
    assert d.result == "MISMATCH"
    assert "plate_fastag" in d.caught_by
    assert "length" not in d.caught_by  # same-size truck: only the tag cross-check catches it


def test_s5_everything_removed_is_default_deny():
    d = evaluate(Reading(None, None, 8.4), None, None, authorise=AUTH_OK)
    assert d.result == "UNIDENTIFIED"
    assert "default_deny" in d.caught_by
    assert {"PLATE_MISSING", "TAG_MISSING"} <= set(d.flags)


def test_strict_mode_genuine_plate_but_tag_missing_is_not_identified():
    d = evaluate(Reading("OD09AC5678", None, 8.2), T2, None, authorise=AUTH_OK)
    assert d.result == "UNIDENTIFIED"
    assert "fastag_present" in d.caught_by and "default_deny" in d.caught_by


def test_identified_but_not_authorised():
    d = evaluate(Reading("OD09AC5678", "TAG2", 8.2), T2, T2, authorise=AUTH_NO)
    assert d.result == "NOT_AUTHORISED"
    assert "authorisation" in d.caught_by


def test_invalid_plate_format_is_unidentified():
    d = evaluate(Reading("0D09AB1234", None, 8.3), None, None, authorise=AUTH_OK)
    assert d.result == "UNIDENTIFIED"
    assert "plate_format" in d.caught_by
