import type { SupabaseClient } from "@supabase/supabase-js";
import zipcodes from "zipcodes";
import { internalStar } from "@/lib/match/compatibility";
import { estimateDriveMinutesFromZip, resolveDriveTimeDestination } from "@/lib/venueDistance";

type DbError = { message: string; code?: string } | null;

const IN_CHUNK = 150;

export function looksLikeMissingColumn(err: DbError | undefined, col: string): boolean {
  const msg = err?.message ?? "";
  if (!msg || !msg.toLowerCase().includes(col.toLowerCase())) return false;
  return err?.code === "42703" || err?.code === "PGRST204" || /column|schema cache|could not find/i.test(msg);
}

export function looksLikeMissingRelation(err: DbError | undefined, table: string): boolean {
  const msg = err?.message ?? "";
  if (!msg || !msg.toLowerCase().includes(table.toLowerCase())) return false;
  return err?.code === "42P01" || err?.code === "PGRST205" || /does not exist|schema cache|could not find the table/i.test(msg);
}

/**
 * Runs `query` with `base` + `optional` columns, dropping any optional column the
 * database reports as missing (pending migrations) and retrying.
 */
export async function selectWithOptionalColumns<T>(
  query: (cols: string) => PromiseLike<{ data: unknown; error: DbError }>,
  base: string[],
  optional: string[],
): Promise<{ data: T[]; error: DbError; missing: string[] }> {
  const missing: string[] = [];
  let remaining = [...optional];
  for (;;) {
    const res = await query([...base, ...remaining].join(","));
    if (!res.error) return { data: ((res.data as T[] | null) ?? []) as T[], error: null, missing };
    const gone = remaining.find((c) => looksLikeMissingColumn(res.error, c));
    if (!gone) return { data: [], error: res.error, missing };
    missing.push(gone);
    remaining = remaining.filter((c) => c !== gone);
  }
}

/** `.in()` over many ids in chunks; first error wins. */
export async function selectInChunks<T>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown; error: DbError }>,
): Promise<{ data: T[]; error: DbError }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const res = await query(unique.slice(i, i + IN_CHUNK));
    if (res.error) return { data: [], error: res.error };
    out.push(...(((res.data as T[] | null) ?? []) as T[]));
  }
  return { data: out, error: null };
}

export type MatchProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  zip_code: string | null;
  max_drive_minutes: number | null;
  approved: boolean | null;
  playing_position: string | null;
  primary_position?: string | null;
  secondary_positions?: string[] | null;
  allow_host_invites?: boolean | null;
};

const PROFILE_BASE = ["id", "first_name", "last_name", "avatar_url", "zip_code", "max_drive_minutes", "approved", "playing_position"];
const PROFILE_OPTIONAL = ["primary_position", "secondary_positions", "allow_host_invites"];

export async function loadMatchProfiles(
  admin: SupabaseClient,
  ids: string[],
): Promise<{ byId: Map<string, MatchProfile>; error: DbError; missing: string[] }> {
  const byId = new Map<string, MatchProfile>();
  let missing: string[] = [];
  const res = await selectInChunks<MatchProfile>(ids, async (chunk) => {
    const r = await selectWithOptionalColumns<MatchProfile>(
      (cols) => admin.from("profiles").select(cols).in("id", chunk),
      PROFILE_BASE,
      PROFILE_OPTIONAL.filter((c) => !missing.includes(c)),
    );
    missing = Array.from(new Set([...missing, ...r.missing]));
    return { data: r.data, error: r.error };
  });
  for (const p of res.data) byId.set(p.id, p);
  return { byId, error: res.error, missing };
}

/** Missing `allow_host_invites` (column not migrated or null) means invites are on. */
export function allowsHostInvites(p: Pick<MatchProfile, "allow_host_invites"> | null | undefined): boolean {
  return p?.allow_host_invites !== false;
}

export function playerPositions(p: MatchProfile | null | undefined): { primary: string | null; secondary: string[] } {
  if (!p) return { primary: null, secondary: [] };
  const primary = p.primary_position?.trim() || p.playing_position?.trim() || null;
  const secondary = Array.isArray(p.secondary_positions)
    ? p.secondary_positions.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  return { primary, secondary };
}

/**
 * `internal` is for scoring only (real star, else tier stand-in).
 * `real` holds `star_rating` values and is the only map that may reach a client.
 */
export async function loadStars(
  admin: SupabaseClient,
  ids: string[],
): Promise<{ internal: Map<string, number>; real: Map<string, number>; error: DbError }> {
  const internal = new Map<string, number>();
  const real = new Map<string, number>();
  let missing: string[] = [];
  const res = await selectInChunks<{ user_id: string; tier: string | null; star_rating?: number | string | null }>(
    ids,
    async (chunk) => {
      const r = await selectWithOptionalColumns<{ user_id: string; tier: string | null; star_rating?: number | string | null }>(
        (cols) => admin.from("player_ratings").select(cols).in("user_id", chunk),
        ["user_id", "tier"],
        missing.includes("star_rating") ? [] : ["star_rating"],
      );
      missing = Array.from(new Set([...missing, ...r.missing]));
      return { data: r.data, error: r.error };
    },
  );
  for (const row of res.data) {
    const s = internalStar(row);
    if (s != null) internal.set(row.user_id, s);
    const n = row.star_rating == null ? NaN : Number(row.star_rating);
    if (Number.isFinite(n)) real.set(row.user_id, n);
  }
  return { internal, real, error: res.error };
}

export const ATTENDEE_STATUSES = ["confirmed"] as const;
export const INACTIVE_RSVP_STATUSES = new Set(["canceled", "cancelled"]);

export async function loadConfirmedAttendees(
  admin: SupabaseClient,
  runIds: string[],
): Promise<{ byRun: Map<string, string[]>; error: DbError }> {
  const byRun = new Map<string, string[]>();
  const res = await selectInChunks<{ run_id: string; user_id: string }>(runIds, (chunk) =>
    admin.from("pickup_run_rsvps").select("run_id,user_id").in("run_id", chunk).in("status", [...ATTENDEE_STATUSES]),
  );
  for (const r of res.data) {
    if (!r.user_id) continue;
    const list = byRun.get(r.run_id) ?? [];
    if (!list.includes(r.user_id)) list.push(r.user_id);
    byRun.set(r.run_id, list);
  }
  return { byRun, error: res.error };
}

/** `timesWith`: how many completed sessions this user attended together with each other player. */
export type PlayHistory = { playedWith: Set<string>; pastStarts: string[]; timesWith?: Map<string, number> };

/**
 * Who each user attended a completed session with, and when they played.
 * session_attendance (status attended) joined to pickup_runs (status completed)
 * through tier_session_id, as three separate queries.
 */
export async function loadPlayHistory(
  admin: SupabaseClient,
  userIds: string[],
): Promise<{ byUser: Map<string, PlayHistory>; error: DbError }> {
  const byUser = new Map<string, PlayHistory>();
  for (const id of userIds) byUser.set(id, { playedWith: new Set(), pastStarts: [], timesWith: new Map() });
  if (!userIds.length) return { byUser, error: null };

  const mine = await selectInChunks<{ session_id: string; user_id: string }>(userIds, (chunk) =>
    admin.from("session_attendance").select("session_id,user_id").in("user_id", chunk).eq("status", "attended"),
  );
  if (mine.error) return { byUser, error: mine.error };
  const sessionIds = Array.from(new Set(mine.data.map((r) => r.session_id)));
  if (!sessionIds.length) return { byUser, error: null };

  const runs = await selectInChunks<{ tier_session_id: string; start_at: string }>(sessionIds, (chunk) =>
    admin.from("pickup_runs").select("tier_session_id,start_at").in("tier_session_id", chunk).eq("status", "completed"),
  );
  if (runs.error) return { byUser, error: runs.error };
  const startBySession = new Map(runs.data.map((r) => [r.tier_session_id, r.start_at]));
  const completed = Array.from(startBySession.keys());
  if (!completed.length) return { byUser, error: null };

  const everyone = await selectInChunks<{ session_id: string; user_id: string }>(completed, (chunk) =>
    admin.from("session_attendance").select("session_id,user_id").in("session_id", chunk).eq("status", "attended"),
  );
  if (everyone.error) return { byUser, error: everyone.error };
  const bySession = new Map<string, string[]>();
  for (const r of everyone.data) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r.user_id);
    bySession.set(r.session_id, list);
  }

  for (const r of mine.data) {
    const start = startBySession.get(r.session_id);
    const h = byUser.get(r.user_id);
    if (!start || !h) continue;
    h.pastStarts.push(start);
    for (const other of bySession.get(r.session_id) ?? []) {
      if (other !== r.user_id) {
        h.playedWith.add(other);
        h.timesWith?.set(other, (h.timesWith.get(other) ?? 0) + 1);
      }
    }
  }
  return { byUser, error: null };
}

export type RunLocationFields = {
  latitude?: number | null;
  longitude?: number | null;
  location_private?: string | null;
  location_text?: string | null;
  venue_zip_code?: string | null;
  service_region?: string | null;
};

export function runLatLng(run: RunLocationFields): { lat: number; lng: number } | null {
  if (run.latitude != null && run.longitude != null && Number.isFinite(run.latitude) && Number.isFinite(run.longitude)) {
    return { lat: run.latitude, lng: run.longitude };
  }
  const dest = resolveDriveTimeDestination({
    venueZipCode: run.venue_zip_code,
    locationPrivate: run.location_private ?? run.location_text,
    serviceRegion: run.service_region,
  });
  return dest ? { lat: dest.lat, lng: dest.lng } : null;
}

export function driveMinutesToRun(zip: string | null | undefined, run: RunLocationFields): number | null {
  const at = runLatLng(run);
  return at ? estimateDriveMinutesFromZip(zip, at.lat, at.lng) : null;
}

/** Town name for a ZIP. Never return the ZIP itself. */
export function townFromZip(zip: string | null | undefined): string | null {
  const digits = String(zip ?? "").replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return null;
  const loc = zipcodes.lookup(digits) as { city?: string } | undefined;
  const city = loc?.city?.trim();
  return city || null;
}

export function lastInitial(lastName: string | null | undefined): string | null {
  const c = String(lastName ?? "").trim().charAt(0);
  return c ? c.toUpperCase() : null;
}
