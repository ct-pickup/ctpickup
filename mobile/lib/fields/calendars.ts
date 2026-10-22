export type CalendarRow = {
  venue_key: string;
  provider: "google" | "ical" | "town_feed" | null;
  calendar_url: string | null;
  sync_status: "live" | "failed" | "not_connected";
  last_synced_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  venues: { name: string } | { name: string }[] | null;
};

export type CalendarState = "live" | "failed" | "stale" | "not_connected";

/** Same freshness rule as the database function connected_venue_keys(): live and synced within 24 hours. */
export const LIVE_WINDOW_MS = 24 * 3_600_000;

export function calendarState(r: Pick<CalendarRow, "sync_status" | "last_synced_at">, nowMs: number = Date.now()): CalendarState {
  if (r.sync_status === "failed") return "failed";
  if (r.sync_status === "not_connected") return "not_connected";
  const t = r.last_synced_at ? Date.parse(r.last_synced_at) : NaN;
  return Number.isFinite(t) && nowMs - t <= LIVE_WINDOW_MS ? "live" : "stale";
}

export function calendarStateLabel(s: CalendarState): string {
  return s === "live" ? "Live" : s === "failed" ? "Sync failed" : s === "stale" ? "Out of date" : "Not connected";
}

export function providerLabel(p: CalendarRow["provider"]): string {
  return p === "google" ? "Google Calendar" : p === "town_feed" ? "Town calendar feed" : "Calendar feed";
}

export function calendarVenueName(r: Pick<CalendarRow, "venues" | "venue_key">): string {
  const v = Array.isArray(r.venues) ? r.venues[0] : r.venues;
  return v?.name ?? r.venue_key;
}

/** The three counts at the top of the screen. Unknown = every venue that is not live. */
export function calendarCounts(rows: Pick<CalendarRow, "sync_status" | "last_synced_at">[], totalVenues: number, nowMs: number = Date.now()) {
  const states = rows.map((r) => calendarState(r, nowMs));
  const live = states.filter((s) => s === "live").length;
  const needsAttention = states.filter((s) => s === "failed" || s === "stale").length;
  return { live, needsAttention, unknown: Math.max(0, totalVenues - live) };
}
