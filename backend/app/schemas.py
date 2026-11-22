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
    rfid_sticker_uid: str | None = Field(default=None, max_length=50)  # GB RFID sticker read by the pole
    rfid_sim_mode: str | None = "genuine"  # PoC sensor truth: genuine | cloned | revoked | unknown_damaged
    qr_token: str | None = Field(default=None, max_length=2000)  # same as pass_token (Gate console name)
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
    entry_weight_t: float | None
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
    rfid_sticker_uid: str | None = None
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
    per_vehicle_trips: int | None = Field(default=None, ge=1)  # contract cap per truck, if any
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
    per_vehicle_trips: int | None = None
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
    gate_events_so_far: int | None = None  # while the run is going: gate events posted so far


class HoldRelease(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class OfficerActionIn(BaseModel):
    """An officer action at the gate: always with a reason (recorded, never deleted)."""

    reason: str = Field(min_length=3, max_length=500)
    observed_at: datetime | None = None  # the console's clock; defaults to now



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
    finished: bool = True  # False = progress so far, the run is still going


class SimRunStart(BaseModel):
    suite: str


class SiteRunStart(BaseModel):
    scenario: str


class SiteScenarioOut(BaseModel):
    scenario: str
    description: str
    days: int
    fleet: int
    trip_limit: int | None


class SimSuiteOut(BaseModel):
    suite: str
    title: str
    description: str
    stories: int


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


# ---------- RFID Stickers ----------
class RfidStickerOut(ORM):
    id: int
    uid: str
    truck_id: int
    status: str
    issued_at: datetime
    expires_at: datetime
    issued_by: int
    revoked_at: datetime | None = None
    revoked_by: int | None = None
    revocation_reason: str | None = None
    replaced_by_sticker_id: int | None = None
    truck: TruckSummary | None = None


class RfidIssueIn(BaseModel):
    truck_id: int
    uid: str = Field(min_length=3, max_length=50)
    validity_days: int = Field(default=365, ge=1, le=3650)


class RfidReplaceIn(BaseModel):
    new_uid: str = Field(min_length=3, max_length=50)
    reason: str = Field(min_length=3)


class RfidRevokeIn(BaseModel):
    reason: str = Field(min_length=3)


# ---------- Quotas ----------
class VehicleQuotaOut(ORM):
    id: int
    permit_id: int | None = None
    truck_id: int
    max_trips: int
    completed_trips: int
    remaining_trips: int
    valid_from: date
    valid_to: date
    status: str
    created_at: datetime
    updated_at: datetime
    truck: TruckSummary | None = None


class QuotaAdjustIn(BaseModel):
    new_max: int = Field(ge=0, le=100000)
    reason: str = Field(min_length=3)


class QuotaAdjustmentOut(ORM):
    id: int
    truck_id: int
    officer_id: int
    previous_max: int
    new_max: int
    delta: int
    reason: str
    created_at: datetime


# ---------- Trip Sessions ----------
class TripSessionOut(ORM):
    id: int
    session_id: str
    trip_code: str
    truck_id: int
    sticker_id: int
    signed_token: str
    token_hash: str
    entry_gate: str
    exit_gate: str | None = None
    entry_movement_id: int | None = None
    exit_movement_id: int | None = None
    status: str
    entry_at: datetime
    expires_at: datetime
    completed_at: datetime | None = None
    created_by: int | None = None
    closed_by: int | None = None
    notes: str | None = None
    permit_id: int | None = None
    entry_weight_t: float | None = None
    exit_weight_t: float | None = None
    net_t: float | None = None
    sms_code: str | None = None
    close_mode: str | None = None
    flags: list[str] = []
    source: str | None = None
    truck: TruckSummary | None = None
    sticker: RfidStickerOut | None = None


class TripCheckOut(BaseModel):
    name: str
    status: str
    detail: str


class GateDecisionOut(MovementOut):
    """Answer to a gate event: the movement, our steps / barrier / alerts, and the trip-authorization view."""

    issued_pass: PassFull | None = None
    trip_checks: list[TripCheckOut] | None = None
    trip_decision: str | None = None  # ENTRY AUTHORIZED | ENTRY REJECTED | EXIT AUTHORIZED | EXIT REJECTED
    trip_session: TripSessionOut | None = None
    quota_remaining: int | None = None
    quota_max: int | None = None


GateEventExtendedIn = GateEventIn  # one gate event schema (kept name for existing imports)
MovementExtendedOut = GateDecisionOut


class ExitVerifyIn(BaseModel):
    gate: str
    truck_plate: str | None = None
    rfid_sticker_uid: str | None = None
    qr_token: str | None = None
    sim_auth_mode: str = "genuine"
    source: str | None = None
    permit_id: int | None = None  # defaults to the real permit


class ExitVerifyOut(BaseModel):
    decision: str
    passed: bool
    reasons: list[str]
    checks: list[TripCheckOut]
    session: TripSessionOut | None = None
    quota_before: int | None = None
    quota_after: int | None = None
    exit_movement_id: int | None = None


# ---------- Edge & Disaster Recovery ----------
class EdgeStateOut(ORM):
    id: int
    active_authority: str
    primary_status: str
    standby_status: str
    wan_connectivity: str
    disaster_recovery_mode: bool
    last_heartbeat: datetime
    last_replication: datetime
    last_snapshot_at: datetime | None = None
    last_snapshot_version: str | None = None
    updated_at: datetime


class EdgeStateUpdate(BaseModel):
    active_authority: str | None = None
    primary_status: str | None = None
    standby_status: str | None = None
    wan_connectivity: str | None = None
    disaster_recovery_mode: bool | None = None


class EmergencyMovementIn(BaseModel):
    truck_plate: str = Field(min_length=3)
    direction: Literal["IN", "OUT"]
    gate: str = Field(min_length=1)
    reason: str = Field(min_length=3)


class EmergencyMovementOut(ORM):
    id: int
    movement_id: int | None = None
    truck_plate: str
    direction: str
    gate: str
    officer_id: int
    reason: str
    reconciled: bool
    reconciled_at: datetime | None = None
    reconciliation_notes: str | None = None
    created_at: datetime


class SnapshotRestoreIn(BaseModel):
    snapshot_envelope: dict
    approval_reason: str = Field(min_length=3)
