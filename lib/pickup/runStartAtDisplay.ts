/**
 * Run kickoff display, always in Eastern time. A run with `time_tbd` has a chosen day but no kickoff yet; its
 * `start_at` is noon Eastern on that day, so the Eastern date is right and only the time is hidden.
 * Keep mobile/lib/pickup/runStartAtDisplay.ts identical (scripts/sync-mobile-lib-pickup.mjs).
 */
const ET = "America/New_York";

export const TIME_TBD_LABEL = "Time TBD";

/** True when the run has a day but no kickoff time (`pickup_runs.time_tbd`; missing reads as false). */
export function runTimeTbd(run: { time_tbd?: unknown } | null | undefined): boolean {
  return run?.time_tbd === true;
}

/** Eastern date line: "Tue, Jul 14, 2026". */
export function fmtPickupRunDateDisplay(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "TBD";
  return d.toLocaleString("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Eastern chip label: "Mon, May 22 · 8:00 PM", or "Mon, May 22 · Time TBD". */
export function fmtPickupSlotChipEt(iso: string | null | undefined, timeTbd = false): string {
  if (!iso) return TIME_TBD_LABEL;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return TIME_TBD_LABEL;
  const date = d.toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return `${date} · ${fmtPickupTimeEt(iso, timeTbd)}`;
}

/** Eastern kickoff time only: "7:30 PM", or "Time TBD". */
export function fmtPickupTimeEt(iso: string | null | undefined, timeTbd = false): string {
  if (!iso || timeTbd) return TIME_TBD_LABEL;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return TIME_TBD_LABEL;
  return d.toLocaleString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
}

/** Eastern date and time: "Tue, Jul 14, 2026, 8:00 PM", or "Tue, Jul 14, 2026 · Time TBD". */
export function fmtPickupDateTimeEt(iso: string | null | undefined, timeTbd = false): string {
  if (!iso) return TIME_TBD_LABEL;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return TIME_TBD_LABEL;
  if (timeTbd) return `${fmtPickupRunDateDisplay(iso)} · ${TIME_TBD_LABEL}`;
  return d.toLocaleString("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Eastern calendar day as `YYYY-MM-DD` (for grouping by day), or null for a missing or invalid time. */
export function etDateKey(value: string | number | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Today · 8:00 PM", "Tomorrow · Time TBD" or "Tue, Jul 14 · 8:00 PM", by Eastern calendar day. */
export function fmtPickupWhenEt(iso: string | null | undefined, timeTbd = false, nowMs: number = Date.now()): string {
  const key = etDateKey(iso);
  const today = etDateKey(nowMs);
  if (!iso || !key || !today) return TIME_TBD_LABEL;
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const time = fmtPickupTimeEt(iso, timeTbd);
  if (key === today) return `Today · ${time}`;
  if (key === tomorrow) return `Tomorrow · ${time}`;
  return fmtPickupSlotChipEt(iso, timeTbd);
}

/** Current hour (0 to 23) in Eastern time. */
export function currentHourEt(): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date());
  const n = Number(hour);
  return Number.isFinite(n) ? n : new Date().getHours();
}

/** Kickoff time not chosen yet (availability poll / admin finalize pending). */
export function isPickupRunTimeTbd(
  status: string | null | undefined,
  finalSlotId: string | null | undefined,
): boolean {
  if (finalSlotId != null && String(finalSlotId).trim() !== "") return false;
  const st = (status ?? "").trim();
  return st === "planning" || st === "likely_on";
}
