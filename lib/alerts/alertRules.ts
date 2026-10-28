import zipcodes from "zipcodes";

import { haversineMiles } from "@/lib/venueDistance";

/**
 * Pure rules for the Fields alerts (no database, no push). The senders in fieldAlerts.ts feed these.
 * Alert defaults mirror mobile/lib/fields/alerts.ts, so the switch a player sees is what the server does.
 */

export type AlertType = "slot_opens" | "request_updates" | "new_games" | "changes_cancellations" | "weekly_roundup";

export const ALERT_DEFAULT_ON: Record<AlertType, boolean> = {
  slot_opens: true,
  request_updates: true,
  new_games: true,
  changes_cancellations: true,
  weekly_roundup: false,
};

/** At most one push of each alert type per player in this many hours. */
export const ALERT_RATE_WINDOW_HOURS = 6;
export const DEFAULT_ALERT_RADIUS_MILES = 10;

export type AlertPrefRow = { user_id: string; alert_type: string; enabled: boolean | null; radius_miles: number | null };

/** Who wants this alert, and within what radius. A player with no row gets the default. */
export function wantedBy(userIds: string[], rows: AlertPrefRow[], type: AlertType): Map<string, number> {
  const byUser = new Map<string, AlertPrefRow>();
  for (const r of rows) if (r.alert_type === type) byUser.set(r.user_id, r);
  const out = new Map<string, number>();
  for (const id of new Set(userIds)) {
    const row = byUser.get(id);
    const on = row ? row.enabled !== false : ALERT_DEFAULT_ON[type];
    if (!on) continue;
    const radius = row?.radius_miles != null && row.radius_miles > 0 ? row.radius_miles : DEFAULT_ALERT_RADIUS_MILES;
    out.set(id, radius);
  }
  return out;
}

/** Centre of a US ZIP, or null. */
export function zipPoint(zip: string | null | undefined): { lat: number; lng: number } | null {
  const digits = zip != null ? String(zip).replace(/\D/g, "").slice(0, 5) : "";
  if (digits.length !== 5) return null;
  const loc = zipcodes.lookup(digits) as { latitude?: number; longitude?: number } | undefined;
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
  return { lat: loc.latitude!, lng: loc.longitude! };
}

/** Players whose home ZIP is within their own radius of the game. A player with no readable ZIP is left out. */
export function withinRadius(profiles: { id: string; zip_code: string | null }[], point: { lat: number; lng: number }, radiusById: Map<string, number>): string[] {
  const out: string[] = [];
  for (const p of profiles) {
    const radius = radiusById.get(p.id);
    if (radius == null) continue;
    const home = zipPoint(p.zip_code);
    if (!home) continue;
    if (haversineMiles(home.lat, home.lng, point.lat, point.lng) <= radius) out.push(p.id);
  }
  return out;
}

export type Window = { starts_at: string; ends_at: string };

/** Booked windows that are still in the future and were in the old calendar but are not in the new one. */
export function freedWindows(before: Window[], after: Window[], now: Date = new Date()): Window[] {
  const key = (w: Window) => `${Date.parse(w.starts_at)}-${Date.parse(w.ends_at)}`;
  const still = new Set(after.map(key));
  return before
    .filter((w) => Date.parse(w.starts_at) > now.getTime() && !still.has(key(w)))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

const ET = "America/New_York";
const dayLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
const timeLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });

export function windowLabel(w: Window): string {
  return `${dayLabel(w.starts_at)}, ${timeLabel(w.starts_at)}`;
}

/** Key for "the same freed time" so a repeat sync does not push again. */
export function slotDedupeKey(venueKey: string, freed: Window[]): string {
  const first = freed[0];
  return `slot:${venueKey}:${first ? Date.parse(first.starts_at) : 0}:${freed.length}`;
}

export function slotOpenCopy(venueName: string, freed: Window[]): { title: string; body: string } {
  const first = freed[0]!;
  const more = freed.length > 1 ? ` and ${freed.length - 1} more` : "";
  return { title: "A time opened up", body: `${venueName}: ${windowLabel(first)}${more}.` };
}

export type VenueChange = "closed" | "removed";

export function venueChangeCopy(venueName: string, change: VenueChange, until?: string | null): { title: string; body: string } {
  if (change === "removed") return { title: "A saved field changed", body: `${venueName} is no longer listed.` };
  const when = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? ` until ${new Date(`${until}T12:00:00Z`).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}` : "";
  return { title: "A saved field changed", body: `${venueName} is closed${when}.` };
}

export function newGameCopy(startAt: string | null, timeTbd: boolean, place: string | null): { title: string; body: string } {
  const when = !startAt || timeTbd ? (startAt ? dayLabel(startAt) : "Time to be set") : windowLabel({ starts_at: startAt, ends_at: startAt });
  return { title: "New game near you", body: place ? `${when} at ${place}` : when };
}

export function gameMovedCopy(title: string | null, startAt: string | null, moved: { time: boolean; place: boolean }): { title: string; body: string } {
  const name = title && title.trim() ? title.trim() : "Your game";
  const what = moved.time && moved.place ? "has a new time and place" : moved.time ? "has a new time" : "has a new place";
  return { title: "Your game changed", body: `${name} ${what}${startAt && moved.time ? `: ${windowLabel({ starts_at: startAt, ends_at: startAt })}` : ""}.` };
}
