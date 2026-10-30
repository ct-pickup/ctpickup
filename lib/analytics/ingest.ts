import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_EVENT_NAMES, regionOf, type EventName, type NewEvent } from "@/lib/analytics/events";

/** The most events one request may carry. The app flushes in batches well under this. */
export const MAX_BATCH = 50;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUTURE_SLACK_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ParsedBatch = { events: NewEvent[]; dropped: number };

/**
 * Turns an app request body into events to store. Anything not allowed is dropped, never repaired:
 * unknown event names, names only the server may write, bad ids, too many events.
 * Times from the phone are trusted only inside a sane window; outside it the server's clock is used.
 */
export function parseClientBatch(body: unknown, userId: string, now = Date.now()): ParsedBatch {
  const out: ParsedBatch = { events: [], dropped: 0 };
  if (!body || typeof body !== "object") return out;
  const b = body as { session_id?: unknown; platform?: unknown; app_version?: unknown; events?: unknown };
  if (!Array.isArray(b.events)) return out;
  const session = typeof b.session_id === "string" ? b.session_id : null;
  const platform = typeof b.platform === "string" ? b.platform : null;
  const appVersion = typeof b.app_version === "string" ? b.app_version : null;
  const list = b.events.slice(0, MAX_BATCH);
  out.dropped += Math.max(0, b.events.length - list.length);
  for (const raw of list) {
    if (!raw || typeof raw !== "object") { out.dropped += 1; continue; }
    const e = raw as { id?: unknown; name?: unknown; at?: unknown; properties?: unknown };
    if (typeof e.id !== "string" || !ID.test(e.id)) { out.dropped += 1; continue; }
    if (typeof e.name !== "string" || !(CLIENT_EVENT_NAMES as readonly string[]).includes(e.name)) { out.dropped += 1; continue; }
    const at = typeof e.at === "number" && Number.isFinite(e.at) && e.at <= now + FUTURE_SLACK_MS && e.at >= now - MAX_AGE_MS ? e.at : now;
    out.events.push({
      key: `c:${userId}:${e.id}`,
      name: e.name as EventName,
      userId,
      occurredAt: at,
      properties: e.properties && typeof e.properties === "object" ? (e.properties as Record<string, unknown>) : {},
      sessionId: session,
      platform,
      appVersion,
      source: "client",
    });
  }
  return out;
}

/** Fills in each event's region from the game it is about (a service region, never a location). */
export async function withRegions(admin: SupabaseClient, events: NewEvent[]): Promise<NewEvent[]> {
  const ids = [...new Set(events.map((e) => e.properties?.run_id).filter((v): v is string => typeof v === "string" && UUID.test(v)))];
  if (!ids.length) return events;
  const { data, error } = await admin.from("pickup_runs").select("id,service_region").in("id", ids);
  if (error || !data) return events;
  const byId = new Map((data as { id: string; service_region: string | null }[]).map((r) => [r.id, regionOf(r)]));
  return events.map((e) => {
    const id = e.properties?.run_id;
    return typeof id === "string" && byId.get(id) ? { ...e, region: byId.get(id) } : e;
  });
}
