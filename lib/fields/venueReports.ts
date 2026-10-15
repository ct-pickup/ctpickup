import type { SupabaseClient } from "@supabase/supabase-js";

import { AUTO_HIDE_PLAYERS, AUTO_HIDE_REASONS, REPORT_REASONS, type SuggestionProblem } from "@/shared/fields/suggestions";

/**
 * Field reports ("Report a problem") and what an admin can do about them. Server only (service role).
 *   - submitReport: saves the report, and hides the field when 3 different players say it does not exist / is not a soccer field
 *   - removeField / restoreField: status removed (never deleted) or back to active
 *   - mergeInto: moves notes and contacts to the other field and removes this one
 *   - movePin: applies the reported location
 *   - markClosedUntil: a closed banner on the field page, the field stays on the map
 * Every venue change is written to venue_data_events (source 'player') with its old and new value.
 */

type Row = Record<string, unknown>;
type Admin = SupabaseClient;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

/** Updates a venue and logs each changed field. Returns the field names that changed. */
async function setFields(admin: Admin, venue: Row, changes: Row, adminId: string | null, nowIso: string): Promise<string[]> {
  const fields = Object.keys(changes).filter((k) => !same(venue[k], changes[k]));
  if (fields.length === 0) return [];
  const patch: Row = { updated_at: nowIso };
  for (const f of fields) patch[f] = changes[f] ?? null;
  const { error } = await admin.from("venues").update(patch).eq("venue_key", venue.venue_key as string);
  if (error) throw new Error(error.message);
  const { error: ee } = await admin.from("venue_data_events").insert(
    fields.map((field) => ({ id: crypto.randomUUID(), venue_key: venue.venue_key, field, old_value: venue[field] ?? null, new_value: changes[field] ?? null, source: "player", changed_by: adminId, changed_at: nowIso })),
  );
  if (ee) throw new Error(ee.message);
  return fields;
}

async function loadVenue(admin: Admin, key: string): Promise<Row | null> {
  const { data, error } = await admin.from("venues").select("*").eq("venue_key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

// ---------------------------------------------------------------------------
// Submitting a report
// ---------------------------------------------------------------------------

export type ReportInput = { venue_key: string; problem: SuggestionProblem; note?: string | null; detail?: string | null; duplicate_of?: string | null; lat?: number | null; lon?: number | null };

/** Counts the different players behind reports that say the field is not real. Rejected reports do not count. */
export function distinctReporters(reports: { user_id: string; problem: string; status: string }[]): number {
  return new Set(reports.filter((r) => (AUTO_HIDE_REASONS as string[]).includes(r.problem) && r.status !== "rejected").map((r) => r.user_id)).size;
}

/** The rule: 3 different players report "Doesn't exist" or "Not a soccer field" for one field. */
export const shouldAutoHide = (reports: { user_id: string; problem: string; status: string }[]): boolean => distinctReporters(reports) >= AUTO_HIDE_PLAYERS;

export async function evaluateAutoHide(admin: Admin, venueKey: string, nowIso: string = new Date().toISOString()): Promise<{ hidden: boolean; players: number }> {
  const { data, error } = await admin.from("venue_suggestions").select("user_id,problem,status").eq("venue_key", venueKey);
  if (error) throw new Error(error.message);
  const reports = (data ?? []) as { user_id: string; problem: string; status: string }[];
  const players = distinctReporters(reports);
  if (players < AUTO_HIDE_PLAYERS) return { hidden: false, players };
  const venue = await loadVenue(admin, venueKey);
  if (!venue || venue.status !== "active") return { hidden: false, players };
  await setFields(admin, venue, { status: "hidden_pending_review", status_reason: `${players} players reported it does not exist or is not a soccer field`, status_changed_at: nowIso }, null, nowIso);
  return { hidden: true, players };
}

export type ReportResult =
  | { ok: true; duplicateReport: boolean; hidden: boolean }
  | { ok: false; code: "invalid" | "venue_missing" | "rate_limited" | "error"; message: string };

export async function submitReport(admin: Admin, userId: string, input: ReportInput, nowIso: string = new Date().toISOString()): Promise<ReportResult> {
  if (!REPORT_REASONS.some((r) => r.key === input.problem)) return { ok: false, code: "invalid", message: "Choose what’s wrong." };
  const detail = clean(input.detail, 500);
  if (input.problem === "wrong_info" && (detail ?? "").length < 3) return { ok: false, code: "invalid", message: "Tell us what’s wrong in a few words." };
  const hasLat = typeof input.lat === "number" && Number.isFinite(input.lat);
  const hasLon = typeof input.lon === "number" && Number.isFinite(input.lon);
  if (hasLat !== hasLon || (hasLat && (Math.abs(input.lat!) > 90 || Math.abs(input.lon!) > 180))) return { ok: false, code: "invalid", message: "That pin location isn’t valid." };
  const venue = await loadVenue(admin, input.venue_key);
  if (!venue) return { ok: false, code: "venue_missing", message: "That field no longer exists." };
  let duplicateOf: string | null = null;
  if (input.problem === "duplicate") {
    duplicateOf = clean(input.duplicate_of, 200);
    if (!duplicateOf || duplicateOf === input.venue_key) return { ok: false, code: "invalid", message: "Pick the other field." };
    if (!(await loadVenue(admin, duplicateOf))) return { ok: false, code: "invalid", message: "Pick the other field." };
  }

  // One report per player per reason per field: pressing send twice (or again later) does not count twice.
  const { data: mine, error: me } = await admin.from("venue_suggestions").select("id,status").eq("venue_key", input.venue_key).eq("user_id", userId).eq("problem", input.problem);
  if (me) return { ok: false, code: "error", message: "We couldn’t save that. Please try again." };
  if (((mine ?? []) as { status: string }[]).some((r) => r.status === "pending")) return { ok: true, duplicateReport: true, hidden: false };

  const { error } = await admin.from("venue_suggestions").insert({
    user_id: userId,
    kind: "correction",
    venue_key: input.venue_key,
    problem: input.problem,
    lat: input.problem === "wrong_location" && hasLat ? input.lat : null,
    lon: input.problem === "wrong_location" && hasLon ? input.lon : null,
    note: clean(input.note, 1000),
    detail,
    duplicate_of: duplicateOf,
    status: "pending",
  });
  if (error) {
    if (/venue_suggestion_rate_limit/.test(error.message)) return { ok: false, code: "rate_limited", message: "You have a lot of suggestions waiting. We’ll get to them first." };
    return { ok: false, code: "error", message: "We couldn’t save that. Please try again." };
  }
  const { hidden } = await evaluateAutoHide(admin, input.venue_key, nowIso);
  return { ok: true, duplicateReport: false, hidden };
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true; fields: string[] } | { ok: false; error: "venue_missing" | "target_missing" | "target_inactive" | "same_venue" | "bad_date" | "no_location" };

export async function removeField(admin: Admin, venueKey: string, adminId: string, reason: string | null = null, nowIso: string = new Date().toISOString()): Promise<ActionResult> {
  const v = await loadVenue(admin, venueKey);
  if (!v) return { ok: false, error: "venue_missing" };
  return { ok: true, fields: await setFields(admin, v, { status: "removed", status_reason: reason ?? "Removed by an admin", status_changed_at: nowIso }, adminId, nowIso) };
}

export async function restoreField(admin: Admin, venueKey: string, adminId: string, nowIso: string = new Date().toISOString()): Promise<ActionResult> {
  const v = await loadVenue(admin, venueKey);
  if (!v) return { ok: false, error: "venue_missing" };
  return { ok: true, fields: await setFields(admin, v, { status: "active", status_reason: null, status_changed_at: nowIso, merged_into: null }, adminId, nowIso) };
}

/** Appends a block to a notes column without repeating one that is already there. */
function appendBlock(existing: unknown, block: string): string {
  const base = typeof existing === "string" ? existing.trim() : "";
  return base.includes(block) ? base : base ? `${base}\n${block}` : block;
}

/**
 * Merges a duplicate into the field that stays: its notes, availability notes and any contact details the other one lacks move
 * across, then the duplicate is removed (status removed, merged_into set), never deleted.
 */
export async function mergeInto(admin: Admin, fromKey: string, toKey: string, adminId: string, nowIso: string = new Date().toISOString()): Promise<ActionResult> {
  if (fromKey === toKey) return { ok: false, error: "same_venue" };
  const from = await loadVenue(admin, fromKey);
  if (!from) return { ok: false, error: "venue_missing" };
  const to = await loadVenue(admin, toKey);
  if (!to) return { ok: false, error: "target_missing" };
  if (to.status !== "active") return { ok: false, error: "target_inactive" };

  const label = String(from.name ?? fromKey);
  const changes: Row = {};
  const fromNotes = typeof from.player_notes === "string" ? from.player_notes.trim() : "";
  changes.player_notes = appendBlock(to.player_notes, `[merged from ${label}]${fromNotes ? `\n${fromNotes}` : ""}`);
  if (typeof from.availability_notes === "string" && from.availability_notes.trim()) changes.availability_notes = appendBlock(to.availability_notes, `[merged from ${label}] ${from.availability_notes.trim()}`);
  for (const col of ["contact_text", "booking_phone", "booking_url", "website", "booking_basis"] as const) {
    const mine = typeof to[col] === "string" ? (to[col] as string).trim() : "";
    const theirs = typeof from[col] === "string" ? (from[col] as string).trim() : "";
    if (!mine && theirs) changes[col] = theirs;
  }
  const fields = await setFields(admin, to, changes, adminId, nowIso);
  const gone = await setFields(admin, from, { status: "removed", status_reason: `Merged into ${String(to.name ?? toKey)}`, status_changed_at: nowIso, merged_into: toKey }, adminId, nowIso);
  return { ok: true, fields: [...fields, ...gone.map((f) => `${fromKey}.${f}`)] };
}

/** Applies the location a player reported. lat and lon are locked so an import cannot move it back. */
export async function movePin(admin: Admin, venueKey: string, lat: number | null, lon: number | null, adminId: string, nowIso: string = new Date().toISOString()): Promise<ActionResult> {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: "no_location" };
  const v = await loadVenue(admin, venueKey);
  if (!v) return { ok: false, error: "venue_missing" };
  const locks = [...new Set([...(Array.isArray(v.locked_fields) ? (v.locked_fields as string[]) : []), "lat", "lon"])];
  return { ok: true, fields: await setFields(admin, v, { lat, lon, locked_fields: locks }, adminId, nowIso) };
}

/** A closed banner on the field page until the date. The field stays on the map. */
export async function markClosedUntil(admin: Admin, venueKey: string, until: string, reason: string | null, adminId: string, nowIso: string = new Date().toISOString()): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(`${until}T12:00:00Z`))) return { ok: false, error: "bad_date" };
  const v = await loadVenue(admin, venueKey);
  if (!v) return { ok: false, error: "venue_missing" };
  return { ok: true, fields: await setFields(admin, v, { closed_until: until, closed_reason: clean(reason, 200) }, adminId, nowIso) };
}

/** Marks the report that triggered an action as handled. */
export async function resolveReport(admin: Admin, suggestionId: string, adminId: string, nowIso: string = new Date().toISOString()): Promise<void> {
  const { error } = await admin.from("venue_suggestions").update({ status: "approved", reviewed_by: adminId, reviewed_at: nowIso }).eq("id", suggestionId);
  if (error) throw new Error(error.message);
}
