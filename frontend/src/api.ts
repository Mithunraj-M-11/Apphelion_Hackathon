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
};

// ---------- Gate events & simulator runs ----------
export type Check = { name: string; status: "passed" | "failed" | "not_applicable"; detail: string };
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
};
export type ScenarioResult = {
  id: string;
  name: string;
  kind: "honest" | "tamper";
  why: string | null;
  real_case: string | null;
  readings: { plate_read: string | null; fastag_read: string | null; radar_length_m: number | null };
  expected: { result: string; caught_by?: string[]; not_caught_by?: string[] };
  actual: { result: string; caught_by: string[]; flags: string[]; reasons: string[] };
  movement_id: number;
  pass: boolean;
  problems: string[];
};
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
  movements: (params: { result?: string; source_prefix?: string; origin?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Movement[]>(`/movements${qs.toString() ? `?${qs}` : ""}`);
  },
  simRuns: () => request<SimRun[]>("/sim-runs"),
  simRun: (id: number) => request<SimRun>(`/sim-runs/${id}`),
  /** What a gate pole sends (no officer: poles are machines). */
  postEvent: (gate: string, body: GateEventIn) =>
    request<Movement>(`/gates/${gate}/events`, { method: "POST", body: JSON.stringify(body) }, false),
  logs: (source: string, limit = 300) =>
    request<LogEntry[]>(`/logs?${new URLSearchParams({ source, limit: String(limit) })}`),
};

export type GateEventIn = {
  direction: "IN" | "OUT";
  plate_read: string | null;
  fastag_read: string | null;
  radar_length_m: number | null;
  source: string;
};

export type LogEntry = {
  id: number;
  at: string;
  component: string;
  level: "INFO" | "WARN" | "ALERT";
  message: string;
  movement_id: number | null;
  source: string | null;
  context: Record<string, unknown> | null;
};
