"""Indian number-plate normalisation and format checks.

Used by the registry (enrollment) and by the gate flow (plate reads). A reading that doesn't fit a real Indian
format is treated as unreadable: we never "fix" it by guessing the nearest registered plate.
"""

import re

# State / UT codes, including older codes still seen on vehicles (OR for Odisha, UA for Uttarakhand;
# Telangana has both TS and TG).
STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR", "JH", "JK", "KA",
    "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TG", "TN",
    "TR", "TS", "UA", "UK", "UP", "WB",
}

# Standard: state (2 letters) + RTO (1-2 digits) + series (0-3 letters) + number (exactly 4 digits).
# High-security plates always print 4 digits (e.g. 0009), so a shorter number is a partial read, not a plate.
_STANDARD = re.compile(r"^(?P<state>[A-Z]{2})(?P<rto>[0-9]{1,2})(?P<series>[A-Z]{0,3})(?P<num>[0-9]{4})$")
# Bharat series: year (2 digits) + BH + number (4 digits) + letters (1-2)
_BH = re.compile(r"^(?P<year>[0-9]{2})BH(?P<num>[0-9]{4})(?P<series>[A-Z]{1,2})$")


class PlateFormatError(ValueError):
    pass


def normalise_plate(raw: str) -> str:
    """Uppercase and remove spaces, dashes and dots: 'ka 01-ab 1234' -> 'KA01AB1234'."""
    return re.sub(r"[\s\-.]", "", raw or "").upper()


def plate_type(plate: str) -> str | None:
    """Return 'standard' or 'bh' if the normalised plate is a valid Indian format, else None."""
    m = _STANDARD.match(plate)
    if m and m.group("state") in STATE_CODES and int(m.group("num")) > 0:
        return "standard"
    if _BH.match(plate):
        return "bh"
    return None


def validate_indian_plate(raw: str) -> tuple[str, str]:
    """Normalise and validate. Returns (plate, plate_type) or raises PlateFormatError."""
    plate = normalise_plate(raw)
    kind = plate_type(plate)
    if kind is None:
        raise PlateFormatError(f"'{raw}' is not a valid Indian number plate")
    return plate, kind
