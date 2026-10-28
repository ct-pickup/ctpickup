import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * First-party product analytics (table public.analytics_events, migration 20261026000000). Server side.
 *
 * Privacy rules enforced here AND by a CHECK in the database:
 *   - only allowlisted event names and property keys;
 *   - property values are booleans, numbers, or short plain tokens (no spaces, no @): no names, emails, phone numbers or free text;
 *   - region is a service region or town, never a location.
 * Recording never throws and never blocks the request that caused it.
 */

export const EVENT_NAMES = [
  "account_approved", "run_list_viewed", "run_viewed", "recommendation_shown", "recommendation_tapped",
  "rsvp_started", "rsvp_completed", "rsvp_cancelled", "waitlisted", "waitlist_promoted",
  "checked_in", "attended", "no_show", "postgame_vote_completed", "play_again_tapped",
  "push_sent", "push_opened", "alert_subscribed", "field_viewed", "field_request_sent",
  "push_suppressed", "push_pref_changed", "play_again_created",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** The only events the app may send itself. Everything else is written by the server from what really happened. */
export const CLIENT_EVENT_NAMES: readonly EventName[] = [
  "run_list_viewed", "run_viewed", "recommendation_shown", "recommendation_tapped", "rsvp_started", "play_again_tapped", "push_opened", "alert_subscribed", "field_viewed",
];

export const PROPERTY_KEYS = [
  "run_id", "venue_key", "kind", "category", "reason", "reasons", "position", "count", "from_screen", "list_kind",
  "push_id", "alert_type", "enabled", "role", "status", "result", "step", "trigger", "rank", "minutes_before", "days",
  "hours", "price_cents", "capacity", "spots_left", "new_run_id", "vote_type",
] as const;

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

const TOKEN = /^[A-Za-z0-9_.:,|-]{1,64}$/;
const KEYS = new Set<string>(PROPERTY_KEYS);
const MAX_KEYS = 12;

/** Keeps only allowed keys with clean scalar values. Anything else is dropped, never rewritten. */
export function sanitizeProperties(input: unknown): Props {
  const out: Props = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (!KEYS.has(k)) continue;
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9) out[k] = v;
    else if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  return out;
}

const REGION = /^[A-Za-z0-9 ._-]{1,32}$/;
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const PLATFORMS = new Set(["ios", "android", "web"]);

export type NewEvent = {
  /** Idempotency key: the same key is stored once. Build it from facts that repeat on a retry (a row id, a Stripe event id). */
  key: string;
  name: EventName;
  userId?: string | null;
  occurredAt?: Date | string | number;
  region?: string | null;
  properties?: Record<string, unknown>;
  sessionId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  source: "server" | "client";
};

type Row = {
  event_key: string; occurred_at: string; user_id: string | null; session_id: string | null; platform: string | null;
  app_version: string | null; region: string | null; name: string; properties: Props; source: string;
};

/** The row to store, or null when the event itself is not valid (bad name or key). */
export function toRow(e: NewEvent): Row | null {
  if (!(EVENT_NAMES as readonly string[]).includes(e.name)) return null;
  if (typeof e.key !== "string" || e.key.length < 8 || e.key.length > 160) return null;
  const when = e.occurredAt === undefined ? new Date() : new Date(e.occurredAt);
  if (!Number.isFinite(when.getTime())) return null;
  return {
    event_key: e.key,
    occurred_at: when.toISOString(),
    user_id: e.userId ?? null,
    session_id: e.sessionId && SESSION.test(e.sessionId) ? e.sessionId : null,
    platform: e.platform && PLATFORMS.has(e.platform) ? e.platform : null,
    app_version: e.appVersion && VERSION.test(e.appVersion) ? e.appVersion : null,
    region: e.region && REGION.test(e.region) ? e.region : null,
    name: e.name,
    properties: sanitizeProperties(e.properties),
    source: e.source,
  };
}

let missingUntil = 0;
const MISSING = /does not exist|could not find the table|schema cache|42P01|PGRST205/i;

/**
 * Stores events (a batch is one insert; a repeated key is ignored). If the table is not there yet it backs off for a minute.
 * If a batch is refused (a row the database does not like), the rows are tried one by one so one bad event cannot lose the others.
 * Returns how many were sent to the database. Never throws.
 */
export async function recordEvents(admin: SupabaseClient, events: NewEvent[]): Promise<number> {
  try {
    if (Date.now() < missingUntil) return 0;
    const rows = events.map(toRow).filter((r): r is Row => r !== null);
    if (!rows.length) return 0;
    let stored = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("analytics_events").upsert(chunk, { onConflict: "event_key", ignoreDuplicates: true });
      if (!error) {
        stored += chunk.length;
        continue;
      }
      if (MISSING.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
        missingUntil = Date.now() + 60_000;
        return stored;
      }
      for (const row of chunk) {
        const one = await admin.from("analytics_events").upsert(row, { onConflict: "event_key", ignoreDuplicates: true });
        if (!one.error) stored += 1;
      }
    }
    return stored;
  } catch (e) {
    console.error("[analytics] record failed", e instanceof Error ? e.message : "unknown");
    return 0;
  }
}

export const recordEvent = (admin: SupabaseClient, e: NewEvent): Promise<number> => recordEvents(admin, [e]);

/** For tests: forget that the table was missing. */
export function resetAnalyticsBackoff(): void {
  missingUntil = 0;
}

/** Whether a player has switched off optional client events. Unknown means on, because the flag and the route still gate it. */
export async function clientEventsAllowed(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("profiles").select("analytics_opt_out").eq("id", userId).maybeSingle();
  if (error) return false; // cannot tell: send nothing
  return (data as { analytics_opt_out?: boolean } | null)?.analytics_opt_out !== true;
}

/** Region of a game for events. Service region code only. */
export function regionOf(run: { service_region?: string | null } | null | undefined): string | null {
  const r = run?.service_region?.trim();
  return r && REGION.test(r) ? r : null;
}

/** One postgame_vote_completed per player, per game, per kind of vote. The key repeats on a retry, so it is stored once. */
export function postgameVoteEvent(runId: string, userId: string, voteType: "peer_vote" | "potd" | "host_rating"): NewEvent {
  return {
    key: `postgame_vote_completed:${voteType}:${runId}:${userId}`,
    name: "postgame_vote_completed",
    userId,
    source: "server",
    properties: { run_id: runId, vote_type: voteType },
  };
}
