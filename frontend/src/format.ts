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
