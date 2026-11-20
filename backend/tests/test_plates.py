import pytest

from app.services.plates import PlateFormatError, normalise_plate, plate_type, validate_indian_plate


@pytest.mark.parametrize(
    "raw, expected",
    [("ka 01 ab 1234", "KA01AB1234"), ("OD-09-AB-1234", "OD09AB1234"), (" od09ab1234 ", "OD09AB1234")],
)
def test_normalise(raw, expected):
    assert normalise_plate(raw) == expected


@pytest.mark.parametrize(
    "plate, kind",
    [
        ("OD09AB1234", "standard"),
        ("DL1CAB1234", "standard"),
        ("KA05M9", "standard"),       # short series / number still valid
        ("JH05CK2290", "standard"),
        ("22BH4581AB", "bh"),
        ("21BH0001A", "bh"),
    ],
)
def test_valid_formats(plate, kind):
    assert plate_type(plate) == kind


@pytest.mark.parametrize(
    "plate",
    [
        "OD09A81234X",   # extra character
        "XX09AB1234",    # unknown state code
        "OD09AB0000",    # number can't be zero
        "0D09AB1234",    # zero instead of O (typical misread)
        "OD09AB12345",   # 5-digit number
        "",
        "22BH458AB",     # BH needs 4 digits
    ],
)
def test_invalid_formats(plate):
    assert plate_type(plate) is None


def test_validate_returns_normalised_and_type():
    assert validate_indian_plate("od 09 ab 1234") == ("OD09AB1234", "standard")


def test_validate_raises():
    with pytest.raises(PlateFormatError):
        validate_indian_plate("NOT A PLATE")
