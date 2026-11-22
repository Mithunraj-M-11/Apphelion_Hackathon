"""CP9: the Vendor's daily claim is checked against the GB's own figures (no database needed)."""

from app.services.trip import compare_vendor


def codes(alerts):
    return [a[0] for a in alerts]


def test_truthful_report_raises_nothing():
    assert compare_vendor(10, 220.0, gb_legal=10, gb_actual=10, gb_tonnes=220.0) == []


def test_hiding_illegal_trips_is_high():
    alerts = compare_vendor(10, 220.0, gb_legal=10, gb_actual=14, gb_tonnes=220.0)
    assert codes(alerts) == ["UNDER_REPORT"] and alerts[0][1] == "HIGH" and "4 trip(s)" in alerts[0][2]


def test_below_legal_trips_says_so():
    alerts = compare_vendor(7, 220.0, gb_legal=10, gb_actual=10, gb_tonnes=220.0)
    assert codes(alerts) == ["UNDER_REPORT"] and "below even the GB-issued legal trips" in alerts[0][2]


def test_tonnes_within_weighbridge_tolerance_is_fine():
    assert compare_vendor(10, 216.0, gb_legal=10, gb_actual=10, gb_tonnes=220.0) == []  # 2% of 220 = 4.4 t


def test_tonnes_under_reported_beyond_tolerance():
    alerts = compare_vendor(10, 200.0, gb_legal=10, gb_actual=10, gb_tonnes=220.0)
    assert codes(alerts) == ["UNDER_REPORT_TONNES"]


def test_over_reporting_is_not_an_under_report():
    assert compare_vendor(12, 260.0, gb_legal=10, gb_actual=10, gb_tonnes=220.0) == []
