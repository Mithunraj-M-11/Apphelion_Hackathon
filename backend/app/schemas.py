"""API request / response models for the registry."""

from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.plates import PlateFormatError, validate_indian_plate

TruckStatus = Literal["active", "suspended", "on_hold", "retired"]
PhotoKind = Literal["plate_front", "plate_rear", "side", "full"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Officers / contracts ----------
class OfficerOut(ORM):
    id: int
    name: str
    role: str
    active: bool


class ContractOut(ORM):
    id: int
    code: str
    vendor_name: str
    site_name: str
    mineral: str | None


# ---------- Transporters / drivers ----------
class DriverIn(BaseModel):
    name: str = Field(min_length=2)
    phone: str = Field(min_length=6)
    licence_no: str | None = None


class DriverOut(ORM):
    id: int
    transporter_id: int
    name: str
    phone: str
    licence_no: str | None
    active: bool


class TransporterIn(BaseModel):
    name: str = Field(min_length=2)
    address: str | None = None
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    contact_person: str | None = None
    contact_phone: str | None = None
    phone_numbers: list[str] = []
    contract_id: int | None = None


class TransporterUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    contact_person: str | None = None
    contact_phone: str | None = None
    phone_numbers: list[str] | None = None
    contract_id: int | None = None


class TransporterSummary(ORM):
    id: int
    name: str


class TransporterOut(ORM):
    id: int
    name: str
    address: str | None
    gstin: str | None
    contact_person: str | None
    contact_phone: str | None
    phone_numbers: list[str]
    contract_id: int | None
    drivers: list[DriverOut] = []
    truck_count: int = 0


# ---------- Trucks ----------
class _TruckFields(BaseModel):
    fastag_tag_id: str | None = None
    fastag_chip_id: str | None = None
    length_m: float | None = Field(default=None, gt=0, lt=30)
    axle_count: int | None = Field(default=None, ge=2, le=10)
    make: str | None = None
    model: str | None = None
    body_type: str | None = None
    colour: str | None = None
    chassis_no: str | None = None
    engine_no: str | None = None
    empty_weight_t: float | None = Field(default=None, gt=0, lt=100)
    rated_capacity_t: float | None = Field(default=None, gt=0, lt=100)
    gvw_t: float | None = Field(default=None, gt=0, lt=150)
    rc_valid_until: date | None = None
    fitness_valid_until: date | None = None
    insurance_valid_until: date | None = None
    permit_valid_until: date | None = None
    vahan_verified: bool | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    transporter_id: int | None = None
    contract_id: int | None = None
    inspection_location: str | None = None
    approved_by: int | None = None


class TruckCreate(_TruckFields):
    plate: str
    length_m: float = Field(gt=0, lt=30)
    empty_weight_t: float = Field(gt=0, lt=100)
    rated_capacity_t: float = Field(gt=0, lt=100)
    transporter_id: int

    @field_validator("plate")
    @classmethod
    def _plate(cls, v: str) -> str:
        try:
            plate, _ = validate_indian_plate(v)
        except PlateFormatError as exc:
            raise ValueError(str(exc)) from exc
        return plate


class TruckUpdate(_TruckFields):
    reason: str | None = None  # optional note stored in history


class StatusChange(BaseModel):
    status: TruckStatus
    reason: str = Field(min_length=3)


class PhotoOut(ORM):
    id: int
    kind: str
    url: str
    uploaded_at: datetime


class Authorisation(BaseModel):
    authorised: bool
    reasons: list[str]


class TruckListItem(ORM):
    id: int
    plate: str
    plate_type: str
    make: str | None
    model: str | None
    body_type: str | None
    status: str
    transporter: TransporterSummary
    authorisation: Authorisation


class TruckOut(ORM):
    id: int
    plate: str
    plate_type: str
    fastag_tag_id: str | None
    fastag_chip_id: str | None
    length_m: float
    axle_count: int | None
    make: str | None
    model: str | None
    body_type: str | None
    colour: str | None
    chassis_no: str | None
    engine_no: str | None
    empty_weight_t: float
    rated_capacity_t: float
    gvw_t: float | None
    rc_valid_until: date | None
    fitness_valid_until: date | None
    insurance_valid_until: date | None
    permit_valid_until: date | None
    vahan_verified: bool
    vahan_checked_at: datetime | None
    status: str
    status_reason: str | None
    valid_from: date | None
    valid_to: date | None
    transporter: TransporterSummary
    contract: ContractOut | None
    inspector: OfficerOut | None
    inspected_at: datetime | None
    inspection_location: str | None
    approver: OfficerOut | None
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    photos: list[PhotoOut] = []
    authorisation: Authorisation


class HistoryOut(ORM):
    id: int
    entity: str
    entity_id: int
    action: str
    officer: OfficerOut
    reason: str | None
    before: dict | None
    after: dict | None
    changed_at: datetime


class LookupOut(BaseModel):
    """Result of looking a gate reading up in the registry (used by the Identify step)."""

    plate_query: str | None
    fastag_query: str | None
    by_plate: TruckListItem | None
    by_fastag: TruckListItem | None
    same_truck: bool | None  # None when only one identifier was given / matched


# ---------- Gate events (Identify) ----------
class GateEventIn(BaseModel):
    """What a gate pole reports. Sensors report what is physically there; null = nothing read."""

    direction: Literal["IN", "OUT"]
    observed_at: datetime | None = None  # defaults to server time
    plate_read: str | None = None
    fastag_read: str | None = None
    radar_length_m: float | None = Field(default=None, gt=0, lt=40)
    weight_t: float | None = Field(default=None, gt=0, lt=200)  # GB weigh pad
    pass_token: str | None = Field(default=None, max_length=2000)  # QR content shown at exit
    pass_code: str | None = Field(default=None, max_length=20)  # SMS code given at exit
    barrier_forced: bool = False  # barrier impact sensor: vehicle broke through
    permit_id: int | None = None  # PoC: real poles resolve the permit from gate config
    source: str | None = Field(default=None, max_length=100)


class CheckOut(BaseModel):
    name: str
    status: str
    detail: str


class TruckSummary(ORM):
    id: int
    plate: str
    plate_type: str


class StepItemOut(BaseModel):
    label: str
    status: str
    detail: str


class StepOut(BaseModel):
    name: str
    status: str
    items: list[StepItemOut]


class AlertOut(ORM):
    id: int
    permit_id: int
    movement_id: int | None
    pass_id: int | None
    truck_id: int | None
    code: str
    severity: str
    message: str
    status: str
    source: str | None
    created_at: datetime


class PassSummary(ORM):
    id: int
    code: str
    truck_id: int
    status: str
    issued_at: datetime
    expires_at: datetime
    closed_at: datetime | None
    entry_weight_t: float
    exit_weight_t: float | None
    net_t: float | None
    close_mode: str | None


class PassFull(PassSummary):
    """What the driver receives: QR content + SMS code (only returned when the pass is issued)."""

    token: str
    sms_code: str
    plate: str


class MovementOut(ORM):
    id: int
    gate: str
    direction: str
    observed_at: datetime
    received_at: datetime
    plate_read: str | None
    plate_normalised: str | None
    fastag_read: str | None
    radar_length_m: float | None
    result: str
    identify_mode: str
    truck: TruckSummary | None = None  # the truck the readings claim to be (if any)
    checks: list[CheckOut]
    caught_by: list[str]
    reasons: list[str]
    flags: list[str]
    source: str | None
    permit_id: int | None = None
    weight_t: float | None = None
    decision: str | None = None
    barrier: str | None = None
    barrier_forced: bool = False
    counted_trip: bool = False
    trip: str | None = None
    steps: list[StepOut] | None = None
    pass_: PassSummary | None = Field(default=None, serialization_alias="pass")
    alerts: list[AlertOut] = []


class GateDecisionOut(MovementOut):
    issued_pass: PassFull | None = None


# ---------- Permits / holds ----------
class PermitIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    valid_from: date
    valid_to: date
    trip_limit: int = Field(ge=1)
    tonne_limit: float = Field(gt=0)
    vehicle_limit: int = Field(ge=1)
    hours_start: time
    hours_end: time
    exit_grace_min: int = Field(default=30, ge=0, le=240)
    pass_expiry_min: int = Field(default=120, ge=5, le=24 * 60)
    source: str | None = Field(default=None, max_length=100)


class PermitOut(ORM):
    id: int
    contract_id: int
    label: str
    valid_from: date
    valid_to: date
    trip_limit: int
    tonne_limit: float
    vehicle_limit: int
    hours_start: time
    hours_end: time
    exit_grace_min: int
    pass_expiry_min: int
    source: str | None
    created_at: datetime


class HoldOut(ORM):
    id: int
    permit_id: int
    truck_id: int
    truck: TruckSummary
    reason_code: str
    movement_id: int | None
    created_at: datetime
    released_at: datetime | None
    released_by: int | None
    release_reason: str | None


class VendorReportIn(BaseModel):
    day: date
    trips: int = Field(ge=0)
    tonnes: float = Field(ge=0)


class SiteRunCreate(BaseModel):
    scenario: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    seed: int
    days: int = Field(ge=1, le=60)
    permit_id: int | None = None


class SiteRunFinish(BaseModel):
    permit_id: int | None = None
    report: dict


class SiteRunOut(ORM):
    id: int
    scenario: str
    description: str | None
    seed: int
    days: int
    permit_id: int | None
    started_at: datetime
    finished_at: datetime | None
    report: dict | None


class HoldRelease(BaseModel):
    reason: str = Field(min_length=3, max_length=500)



# ---------- Simulator runs ----------
class SimRunCreate(BaseModel):
    suite: str = Field(min_length=1, max_length=100)
    identify_mode: str | None = None


class SimRunFinish(BaseModel):
    total: int
    passed: int
    tamper_total: int
    tamper_caught: int
    honest_total: int
    false_alarms: int
    results: list[dict]


class SimRunOut(ORM):
    id: int
    suite: str
    identify_mode: str | None
    started_at: datetime
    finished_at: datetime | None
    total: int
    passed: int
    tamper_total: int
    tamper_caught: int
    honest_total: int
    false_alarms: int
    results: list[dict]
