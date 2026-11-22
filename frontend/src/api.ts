// Typed client for the GB backend. Writes carry the acting officer's id (no login in the PoC).

export type Officer = { id: number; name: string; role: string; active: boolean };
export type Contract = { id: number; code: string; vendor_name: string; site_name: string; mineral: string | null };
export type Authorisation = { authorised: boolean; reasons: string[] };
export type TransporterSummary = { id: number; name: string };
export type Driver = { id: number; transporter_id: number; name: string; phone: string; licence_no: string | null; active: boolean };
export type Transporter = {
  id: number;
  name: string;
  address: string | null;
  gstin: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  phone_numbers: string[];
  contract_id: number | null;
  drivers: Driver[];
  truck_count: number;
};
export type TruckListItem = {
  id: number;
  plate: string;
  plate_type: string;
  make: string | null;
  model: string | null;
  body_type: string | null;
  status: string;
  transporter: TransporterSummary;
  authorisation: Authorisation;
};
export type Photo = { id: number; kind: string; url: string; uploaded_at: string };
export type Truck = {
  id: number;
  plate: string;
  plate_type: string;
  fastag_tag_id: string | null;
  fastag_chip_id: string | null;
  length_m: number;
  axle_count: number | null;
  make: string | null;
  model: string | null;
  body_type: string | null;
  colour: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  empty_weight_t: number;
  rated_capacity_t: number;
  gvw_t: number | null;
  rc_valid_until: string | null;
  fitness_valid_until: string | null;
  insurance_valid_until: string | null;
  permit_valid_until: string | null;
  vahan_verified: boolean;
  vahan_checked_at: string | null;
  status: string;
  status_reason: string | null;
  valid_from: string | null;
  valid_to: string | null;
  transporter: TransporterSummary;
  contract: Contract | null;
  inspector: Officer | null;
  inspected_at: string | null;
  inspection_location: string | null;
  approver: Officer | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  photos: Photo[];
  authorisation: Authorisation;
};
export type HistoryEntry = {
  id: number;
  entity: string;
  entity_id: number;
  action: string;
  officer: Officer;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed_at: string;
};

let actingOfficerId: number | null = null;
export function setActingOfficer(id: number | null) {
  actingOfficerId = id;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? ""}`)
        .join("; ");
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, init: RequestInit = {}, asOfficer = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (asOfficer && init.method && init.method !== "GET") {
    if (actingOfficerId == null) throw new ApiError(0, "Choose an officer in 'Acting as' first");
    headers.set("X-Officer-Id", String(actingOfficerId));
  }
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status));
  return body as T;
}

export const api = {
  officers: () => request<Officer[]>("/officers"),
  contracts: () => request<Contract[]>("/contracts"),
  transporters: () => request<Transporter[]>("/transporters"),
  createTransporter: (data: Partial<Transporter>) =>
    request<Transporter>("/transporters", { method: "POST", body: JSON.stringify(data) }),
  addDriver: (transporterId: number, data: { name: string; phone: string; licence_no?: string | null }) =>
    request<Driver>(`/transporters/${transporterId}/drivers`, { method: "POST", body: JSON.stringify(data) }),
  trucks: (params: { q?: string; status?: string; transporter_id?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<TruckListItem[]>(`/trucks${qs.toString() ? `?${qs}` : ""}`);
  },
  truck: (id: number) => request<Truck>(`/trucks/${id}`),
  history: (id: number) => request<HistoryEntry[]>(`/trucks/${id}/history`),
  createTruck: (data: Record<string, unknown>) =>
    request<Truck>("/trucks", { method: "POST", body: JSON.stringify(data) }),
  updateTruck: (id: number, data: Record<string, unknown>) =>
    request<Truck>(`/trucks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeStatus: (id: number, status: string, reason: string) =>
    request<Truck>(`/trucks/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }),
  uploadPhoto: (id: number, kind: string, file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return request<Truck>(`/trucks/${id}/photos`, { method: "POST", body: form });
  },

  // ---------- RFID Stickers ----------
  rfidStickers: (params: { status?: string; truck_id?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null) as [string, string][]
    );
    return request<RfidSticker[]>(`/rfid-stickers${qs.toString() ? `?${qs}` : ""}`);
  },
  rfidSticker: (id: number) => request<RfidSticker>(`/rfid-stickers/${id}`),
  issueSticker: (data: { truck_id: number; uid: string; validity_days?: number }) =>
    request<RfidSticker>("/rfid-stickers/issue", { method: "POST", body: JSON.stringify(data) }),
  replaceSticker: (id: number, data: { new_uid: string; reason: string }) =>
    request<RfidSticker>(`/rfid-stickers/${id}/replace`, { method: "POST", body: JSON.stringify(data) }),
  revokeSticker: (id: number, data: { reason: string }) =>
    request<RfidSticker>(`/rfid-stickers/${id}/revoke`, { method: "POST", body: JSON.stringify(data) }),

  // ---------- Trip Sessions & Quotas ----------
  trips: (params: { status?: string; plate?: string; trip_code?: string; limit?: number; permit_id?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null) as [string, string][]
    );
    return request<TripSession[]>(`/trips${qs.toString() ? `?${qs}` : ""}`);
  },
  trip: (idOrCode: string | number) => request<TripSession>(`/trips/${idOrCode}`),
  resolveTrip: (sessionId: string, action: "RESOLVE" | "FLAG" | "CANCEL", reason: string) => {
    const qs = new URLSearchParams({ action, reason });
    return request<TripSession>(`/trips/${sessionId}/resolve?${qs}`, { method: "POST" });
  },
  quotas: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<VehicleQuota[]>(`/quotas${qs}`);
  },
  quota: (truckId: number) => request<VehicleQuota>(`/quotas/${truckId}`),
  adjustQuota: (truckId: number, data: { new_max: number; reason: string }) =>
    request<VehicleQuota>(`/quotas/${truckId}/adjust`, { method: "POST", body: JSON.stringify(data) }),
  quotaAdjustments: (truckId: number) => request<QuotaAdjustment[]>(`/quotas/${truckId}/adjustments`),

  // ---------- Edge Infrastructure & Disaster Recovery ----------
  edgeState: () => request<EdgeSystemState>("/edge/state"),
  updateEdgeState: (data: Partial<EdgeSystemState>) =>
    request<EdgeSystemState>("/edge/state", { method: "POST", body: JSON.stringify(data) }),
  generateSnapshot: () => request<RecoverySnapshotEnvelope>("/edge/snapshot", { method: "POST" }),
  restoreSnapshot: (data: { snapshot_envelope: Record<string, unknown>; approval_reason: string }) =>
    request<Record<string, unknown>>("/edge/restore", { method: "POST", body: JSON.stringify(data) }),
  emergencyMovements: () => request<EmergencyMovement[]>("/edge/emergency-movements"),
  recordEmergencyMovement: (data: { truck_plate: string; direction: "IN" | "OUT"; gate: string; reason: string }) =>
    request<EmergencyMovement>("/edge/emergency-movement", { method: "POST", body: JSON.stringify(data) }),
  reconcile: () => request<{ reconciled_count: number; discrepancy_count: number; discrepancies: unknown[] }>("/edge/reconcile", { method: "POST" }),
};

// ---------- Gate events & simulator runs ----------
export type Check = { name: string; status: "passed" | "failed" | "warning" | "not_applicable"; detail: string };
export type Movement = {
  id: number;
  gate: string;
  direction: string;
  observed_at: string;
  received_at: string;
  plate_read: string | null;
  plate_normalised: string | null;
  fastag_read: string | null;
  radar_length_m: number | null;
  result: string;
  identify_mode: string;
  truck: { id: number; plate: string; plate_type: string } | null;
  checks: Check[];
  caught_by: string[];
  reasons: string[];
  flags: string[];
  source: string | null;
  permit_id: number | null;
  weight_t: number | null;
  decision: "ALLOWED" | "REFUSED" | null;
  barrier: "up" | "down" | null;
  barrier_forced: boolean;
  counted_trip: boolean;
  trip: "LEGAL" | "ILLEGAL" | null;
  steps: Step[] | null;
  pass: PassSummary | null;
  alerts: Alert[];
  rfid_sticker_uid?: string | null;
  trip_checks?: Check[] | null;
  trip_decision?: string | null;
  trip_session?: TripSession | null;
  quota_remaining?: number | null;
  quota_max?: number | null;
};
export type GateDecision = Movement & { issued_pass: PassFull | null };

export type StepItem = { label: string; status: "passed" | "failed" | "warning" | "info"; detail: string };
export type Step = { name: string; status: "passed" | "failed" | "warning"; items: StepItem[] };
export type Severity = "INFO" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Alert = {
  id: number;
  permit_id: number;
  movement_id: number | null;
  pass_id: number | null;
  truck_id: number | null;
  code: string;
  severity: Severity;
  message: string;
  status: string;
  source: string | null;
  created_at: string;
};
export type PassSummary = {
  id: number;
  code: string;
  truck_id: number;
  status: TripSession["status"];
  issued_at: string;
  expires_at: string;
  closed_at: string | null;
  entry_weight_t: number;
  exit_weight_t: number | null;
  net_t: number | null;
  close_mode: string | null;
};
export type PassFull = PassSummary & { token: string; sms_code: string; plate: string };
export type Permit = {
  id: number;
  contract_id?: number;
  label: string;
  valid_from: string;
  valid_to: string;
  trip_limit: number;
  tonne_limit: number;
  vehicle_limit: number;
  hours_start: string;
  hours_end: string;
  exit_grace_min: number;
  pass_expiry_min: number;
  per_vehicle_trips?: number | null;
  source: string | null;
};
export type PermitIn = Omit<Permit, "id">;
export type Ledger = {
  permit_id: number;
  trip_limit: number;
  tonne_limit: number;
  vehicle_limit: number;
  trips_reserved: number;
  legal_trips: number;
  open_passes: number;
  actual_trips: number;
  illegal_trips: number;
  tonnes: number;
  vehicles: number;
  active_holds: number;
  unresolved_passes?: number;
  per_vehicle_trips?: number | null;
  provisional_emergency_movements?: number;
  alerts: Record<Severity, number>;
};
export type Hold = {
  id: number;
  permit_id: number;
  truck_id: number;
  truck: { id: number; plate: string; plate_type: string };
  reason_code: string;
  movement_id: number | null;
  created_at: string;
  released_at: string | null;
  released_by: number | null;
  release_reason: string | null;
};

/** Identify-only scenario (identify_basic). */
export type StoryKind = "honest" | "tamper" | "officer";
/** Edge resilience case (edge_resilience): one edge state change, checked against what it should produce. */
export type EdgeScenarioResult = {
  id: string;
  name: string;
  kind: StoryKind;
  category?: string | null;
  why: string | null;
  sheet?: Record<string, unknown>; // the scenario sheet: scenario, step, verdict
  readings: { scenario_type?: string };
  expected: Record<string, unknown>;
  actual: { result: string | null; caught_by?: string[]; reasons?: string[] };
  movement_id: number | null;
  pass: boolean;
  problems: string[];
  format?: undefined;
};
export type TripEventExpect = {
  barrier?: "up" | "down";
  pass_issued?: boolean;
  trip?: string;
  result?: string;
  alerts?: string[];
  not_alerts?: string[];
};
export type TripEventResult = {
  n: number;
  at: string;
  dir: "IN" | "OUT" | "OFFICER" | "UNSEEN" | "INSIDER" | "VENDOR";
  vehicle: string;
  note: string | null;
  readings: {
    plate_read: string | null;
    fastag_read: string | null;
    radar_length_m: number | null;
    weight_t: number | null;
    shown: string | null;
    forced: boolean;
  };
  expected: TripEventExpect;
  actual: {
    result: string;
    decision: string | null;
    barrier: string | null;
    trip: string | null;
    pass_issued: string | null;
    pass: string | null;
    alerts: { code: string; severity: Severity; message: string }[];
  };
  movement_id: number | null;
  pass: boolean;
  problems: string[];
};
/** Full-trip story (gate_cheats). */
export type TripScenarioResult = {
  id: string;
  name: string;
  kind: StoryKind;
  category?: string | null;
  why: string | null;
  real_case: string | null;
  format: "trip";
  sheet?: Record<string, unknown>; // the scenario sheet: scenario, contract, vehicles, steps, verdict
  rules: string | null;
  permit_id: number;
  events: TripEventResult[];
  expected: { alerts: string[] };
  actual: { caught_by: string[]; serious: string[] };
  caught: boolean;
  ledger: Ledger;
  pass: boolean;
  problems: string[];
  // threat_coverage stories: judged against the ideal GB response
  coverage?: "covered" | "partial" | "gap" | "silent";
  threat?: string | null;
  priority?: string | null;
  really_moved?: { trips: number; tonnes: number };
  gb_recorded?: { trips: number; tonnes: number };
};
export type ScenarioResult = EdgeScenarioResult | TripScenarioResult;
export type SimSuite = { suite: string; title: string; description: string; stories: number };
export const isTripResult = (r: ScenarioResult): r is TripScenarioResult => r.format === "trip";

export type SimRun = {
  id: number;
  suite: string;
  identify_mode: string | null;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  tamper_total: number;
  tamper_caught: number;
  honest_total: number;
  false_alarms: number;
  results: ScenarioResult[];
};

export const gateApi = {
  movements: (params: { result?: string; source_prefix?: string; origin?: string; permit_id?: string; limit?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Movement[]>(`/movements${qs.toString() ? `?${qs}` : ""}`);
  },
  simRuns: () => request<SimRun[]>("/sim-runs"),
  simSuites: () => request<SimSuite[]>("/sim-runs/suites"),
  /** Start a suite in the background (the backend runs the simulator, which posts gate events like a pole). */
  startSuite: (suite: string) =>
    request<{ started: string }>("/sim-runs/start", { method: "POST", body: JSON.stringify({ suite }) }, false),
  /** Delete every scenario run and its data. Gate console and site runs are not touched. */
  clearSimRuns: () => request<Record<string, number>>("/sim-runs", { method: "DELETE" }, false),
  simRun: (id: number) => request<SimRun>(`/sim-runs/${id}`),
  /** What a gate pole sends (no officer: poles are machines). */
  postEvent: (gate: string, body: GateEventIn) =>
    request<GateDecision>(`/gates/${gate}/events`, { method: "POST", body: JSON.stringify(body) }, false),
  /** Source-tagged permits (simulator / Gate console) need no officer; real permits do. */
  createPermit: (body: PermitIn) =>
    request<Permit>("/permits", { method: "POST", body: JSON.stringify(body) }, body.source == null),
  permit: (id: number) => request<Permit>(`/permits/${id}`),
  ledger: (id: number) => request<Ledger>(`/permits/${id}/ledger`),
  alerts: (params: { permit_id?: string; severity?: string; origin?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Alert[]>(`/alerts${qs.toString() ? `?${qs}` : ""}`);
  },
  holds: (permitId?: number) => request<Hold[]>(`/holds${permitId != null ? `?permit_id=${permitId}` : ""}`),
  releaseHold: (id: number, reason: string) =>
    request<Hold>(`/holds/${id}/release`, { method: "POST", body: JSON.stringify({ reason }) }),
  /** Delete every Gate console session (permits, gate events, passes, holds, alerts, logs). Demo data only. */
  clearWalkthroughHistory: () =>
    request<Record<string, number>>("/walkthrough-history", { method: "DELETE" }, false),
  /** An officer lets out a truck whose exit was refused: its own pass is closed by the officer and flagged. */
  officerExit: (movementId: number, reason: string) =>
    request<GateDecision>(`/movements/${movementId}/officer-exit`, { method: "POST", body: JSON.stringify({ reason }) }),
  exitVerify: (body: ExitVerifyIn) =>
    request<ExitVerifyOut>("/trips/exit-verify", { method: "POST", body: JSON.stringify(body) }),
  logs: (source: string, limit = 300) =>
    request<LogEntry[]>(`/logs?${new URLSearchParams({ source, limit: String(limit) })}`),
};

export type GateEventIn = {
  direction: "IN" | "OUT";
  plate_read: string | null;
  fastag_read: string | null;
  radar_length_m: number | null;
  weight_t?: number | null;
  pass_token?: string | null;
  pass_code?: string | null;
  barrier_forced?: boolean;
  permit_id?: number;
  observed_at?: string;
  source: string;
  rfid_sticker_uid?: string | null;
  rfid_sim_mode?: "genuine" | "cloned" | "revoked" | "unknown_damaged";
  qr_token?: string | null;
};

export type RfidSticker = {
  id: number;
  uid: string;
  truck_id: number;
  status: "ACTIVE" | "DAMAGED" | "REVOKED" | "EXPIRED" | "REPLACED";
  issued_at: string;
  expires_at: string;
  issued_by: number;
  revoked_at: string | null;
  revoked_by: number | null;
  revocation_reason: string | null;
  replaced_by_sticker_id: number | null;
  truck?: { id: number; plate: string; plate_type: string } | null;
};

export type VehicleQuota = {
  id: number;
  truck_id: number;
  max_trips: number;
  completed_trips: number;
  remaining_trips: number;
  valid_from: string;
  valid_to: string;
  status: "AVAILABLE" | "LOW" | "EXHAUSTED" | "EXPIRED";
  created_at: string;
  updated_at: string;
  truck?: { id: number; plate: string; plate_type: string } | null;
};

export type QuotaAdjustment = {
  id: number;
  truck_id: number;
  officer_id: number;
  previous_max: number;
  new_max: number;
  delta: number;
  reason: string;
  created_at: string;
};

export type TripSession = {
  id: number;
  session_id: string;
  trip_code: string;
  truck_id: number;
  sticker_id: number;
  signed_token: string;
  token_hash: string;
  entry_gate: string;
  exit_gate: string | null;
  entry_movement_id: number | null;
  exit_movement_id: number | null;
  status: "AWAITING_ENTRY_CONFIRMATION" | "ACTIVE" | "COMPLETED" | "EXPIRED_UNRESOLVED" | "FLAGGED" | "CANCELLED";
  entry_at: string;
  expires_at: string;
  completed_at: string | null;
  created_by: number | null;
  closed_by: number | null;
  notes: string | null;
  permit_id?: number | null;
  entry_weight_t?: number | null;
  exit_weight_t?: number | null;
  net_t?: number | null;
  sms_code?: string | null;
  close_mode?: string | null;
  flags?: string[];
  source?: string | null;
  truck?: { id: number; plate: string; plate_type: string } | null;
  sticker?: RfidSticker | null;
};

export type EdgeSystemState = {
  id: number;
  active_authority: "PRIMARY" | "STANDBY" | "EMERGENCY";
  primary_status: "ACTIVE" | "FAILED" | "OFFLINE";
  standby_status: "STANDBY" | "ACTIVE" | "OFFLINE";
  wan_connectivity: "ONLINE" | "WAN_OFFLINE_LOCAL_OPERATIONAL" | "LOCAL_DATA_STALE" | "LOCAL_AUTHORITY_UNAVAILABLE";
  disaster_recovery_mode: boolean;
  last_heartbeat: string;
  last_replication: string;
  last_snapshot_at: string | null;
  last_snapshot_version: string | null;
  updated_at: string;
};

export type EmergencyMovement = {
  id: number;
  movement_id: number | null;
  truck_plate: string;
  direction: "IN" | "OUT";
  gate: string;
  officer_id: number;
  reason: string;
  reconciled: boolean;
  reconciled_at: string | null;
  reconciliation_notes: string | null;
  created_at: string;
};

export type RecoverySnapshotEnvelope = {
  format: string;
  digest: string;
  signature: string;
  algorithm: string;
  data: {
    version: string;
    created_at: string;
    site_code: string;
    trucks: unknown[];
    rfid_stickers: unknown[];
    quotas: unknown[];
    active_and_unresolved_sessions: unknown[];
  };
};

export type ExitVerifyIn = {
  gate: string;
  truck_plate?: string | null;
  rfid_sticker_uid?: string | null;
  qr_token?: string | null;
  sim_auth_mode?: string;
  source?: string | null;
  permit_id?: number;
};

export type ExitVerifyOut = {
  decision: string;
  passed: boolean;
  reasons: string[];
  checks: Check[];
  session: TripSession | null;
  quota_before: number | null;
  quota_after: number | null;
  exit_movement_id: number | null;
};

export type LogEntry = {
  id: number;
  at: string;
  component: string;
  level: "INFO" | "WARN" | "ALERT" | "CRITICAL";
  message: string;
  movement_id: number | null;
  source: string | null;
  context: Record<string, unknown> | null;
};

// ---------- Site-level runs ----------
export type SiteHeadlineRow = {
  permitted: number;
  vendor_reported: number;
  gb_legal: number;
  gb_actual: number;
  gb_illegal: number;
  ground_truth: number;
};
export type SiteCheat = {
  type: string;
  day: string;
  at: string;
  vehicle: string;
  on_refusal: string | null;
  outcome: "prevented" | "detected" | "missed";
  attempt_flagged: boolean;
  alerts: string[];
  first_alert_min: number | null;
  note: string;
  movements?: number[]; // the GB gate events of this attempt
  /** Every leg in order: gate events (seen by the GB) and the legs it cannot see (side tracks, loading inside). */
  timeline?: { at: string; seen: boolean; text: string; movement?: number; alerts?: string[] }[];
};
export type SiteTrip = { day: string; at: string; vehicle: string; tonnes: number; kind: string; cheat: string | null };
export type SiteDay = {
  day: string;
  gb_legal: number;
  gb_actual: number;
  gb_illegal: number;
  entry_refusals: number;
  exit_refusals: number;
  gb_tonnes: number;
  true_trips: number;
  true_tonnes: number;
  invisible_trips: number;
  vendor_trips: number;
  vendor_tonnes: number;
  vendor_alerts: string[];
  alerts: Partial<Record<Severity, number>>;
};
export type SiteReport = {
  config: { days: [string, string]; fleet: number; test_trucks: number; seed: number; permit: Record<string, unknown> };
  permit_id: number;
  gate_events: number;
  headline: { trips: SiteHeadlineRow; tonnes: SiteHeadlineRow };
  accuracy: {
    true_trips: number;
    gb_actual_trips: number;
    trips_never_at_a_gate: number;
    trips_seen_pct: number;
    true_tonnes: number;
    gb_tonnes_weighed: number;
    open_passes: number;
    never_at_a_gate?: SiteTrip[];
  };
  cheats_summary: { injected: number; prevented: number; detected: number; missed: number; missed_attempt_flagged: number };
  cheats_by_type: Record<string, { injected: number; prevented: number; detected: number; missed: number;
    attempt_flagged: number; avg_minutes_to_alert: number | null }>;
  cheats: SiteCheat[];
  alerts: { by_severity: Record<Severity, number>; by_code: Record<string, number> };
  false_alarms: { count: number; honest_events: number; items: { at: string; vehicle: string; code: string; message: string }[] };
  daily: SiteDay[];
  unexpected: string[];
  skipped: string[];
  /** threat_week: what really moved but the GB doesn't have, by why (side track, pole down, rigged pad, ...). */
  missed_by_cause?: Record<string, { trips: number; tonnes: number | null }>;
  /** threat_week: the staged faults and attacks (assumptions stated in the report). */
  staging?: {
    outages: [string, string][];
    weigh_drift: { from_day: number; offset_t: number } | null;
    sensor_noise: { plate_miss?: number; fastag_miss?: number } | null;
    bribed_officer: boolean | null;
    honest_refused_by_misreads: number;
    events_held_by_outages: number;
  };
};
export type SiteRun = {
  id: number;
  scenario: string;
  description: string | null;
  seed: number;
  days: number;
  permit_id: number | null;
  started_at: string;
  finished_at: string | null;
  report: SiteReport | null;
  gate_events_so_far?: number | null; // while the run is going
};
export type SiteScenario = { scenario: string; description: string; days: number; fleet: number; trip_limit: number | null };

export const siteApi = {
  runs: () => request<SiteRun[]>("/site-runs"),
  run: (id: number) => request<SiteRun>(`/site-runs/${id}`),
  scenarios: () => request<SiteScenario[]>("/site-runs/scenarios"),
  /** Start a site scenario in the background (the backend runs the simulator, which posts gate events like poles). */
  start: (scenario: string) =>
    request<{ started: string }>("/site-runs/start", { method: "POST", body: JSON.stringify({ scenario }) }, false),
  /** Delete every site run and its data. Gate console and scenario runs are not touched. */
  clear: () => request<Record<string, number>>("/site-runs", { method: "DELETE" }, false),
};
