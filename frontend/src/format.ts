// Display helpers

/** 'OD09AB1234' -> 'OD 09 AB 1234', '22BH4581AB' -> '22 BH 4581 AB' (display only; stored normalised). */
export function formatPlate(plate: string, type?: string): string {
  if (type === "bh") {
    const m = plate.match(/^(\d{2})BH(\d{4})([A-Z]{1,2})$/);
    return m ? `${m[1]} BH ${m[2]} ${m[3]}` : plate;
  }
  const m = plate.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ") : plate;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Days until a date (negative = past). */
export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(value).getTime() - today.getTime()) / 86_400_000);
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  on_hold: "On hold",
  retired: "Retired",
};

export const RESULT_LABEL: Record<string, string> = {
  AUTHORISED: "Authorised",
  NOT_AUTHORISED: "Not authorised",
  UNREGISTERED: "Unregistered",
  UNIDENTIFIED: "Unidentified",
  MISMATCH: "Mismatch",
};

export const CHECK_LABEL: Record<string, string> = {
  plate_present: "Plate present",
  plate_format: "Plate format",
  registry: "Plate in registry",
  fastag_present: "FASTag present",
  fastag_registry: "FASTag in registry",
  plate_fastag: "Plate vs FASTag",
  length: "Radar length",
  authorisation: "Authorisation",
  default_deny: "Default deny",
};

/** 'sim:12:S3' -> { runId: 12, scenario: 'S3' }; null for real pole events. */
export function parseSimSource(source: string | null): { runId: number; scenario: string } | null {
  const m = source?.match(/^sim:(\d+):(.+)$/);
  return m ? { runId: Number(m[1]), scenario: m[2] } : null;
}

/** The check that decided the result (the rest are supporting evidence). */
export function decisiveCheck(result: string, caughtBy: string[]): string | null {
  const has = (c: string) => caughtBy.includes(c);
  switch (result) {
    case "MISMATCH":
      return has("plate_fastag") ? "plate_fastag" : has("length") ? "length" : caughtBy[0] ?? null;
    case "UNREGISTERED":
      return has("registry") ? "registry" : has("fastag_registry") ? "fastag_registry" : caughtBy[0] ?? null;
    case "UNIDENTIFIED":
      return "default_deny";
    case "NOT_AUTHORISED":
      return "authorisation";
    default:
      return null;
  }
}

export const isWalkthroughSource = (source: string | null) => !!source?.startsWith("walkthrough:");
