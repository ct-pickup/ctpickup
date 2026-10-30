import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidTimeZone, PUSH_PREF_COLUMNS, prefsFromRow, type PushPrefs } from "@/lib/push/pushPolicy";

/** Reading and validating the notification settings a player sends from the app. Server only. */

export type PushSettingsView = {
  categories: { games: boolean; reminders: boolean; results: boolean; chat: boolean; fields: boolean; marketing: boolean };
  quiet: { enabled: boolean; start: number; end: number; timezone: string | null };
};

export const toView = (p: PushPrefs): PushSettingsView => ({
  categories: { ...p.categories, marketing: p.marketing },
  quiet: { enabled: p.quiet.enabled, start: p.quiet.start, end: p.quiet.end, timezone: p.quiet.tz },
});

export type PushSettingsUpdate = {
  categories?: Partial<PushSettingsView["categories"]>;
  quiet?: { enabled?: boolean; start?: number; end?: number; timezone?: string };
};

const CATEGORY_KEYS = ["games", "reminders", "results", "chat", "fields", "marketing"] as const;
const isMinute = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439;

/** Turns a request body into an update, or says what is wrong. Anything unknown is an error, not ignored. */
export function parsePushSettingsUpdate(body: unknown): { ok: true; update: PushSettingsUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body." };
  const b = body as Record<string, unknown>;
  const update: PushSettingsUpdate = {};
  for (const k of Object.keys(b)) if (k !== "categories" && k !== "quiet") return { ok: false, error: `Unknown field ${k}.` };
  if (b.categories !== undefined) {
    if (!b.categories || typeof b.categories !== "object" || Array.isArray(b.categories)) return { ok: false, error: "categories must be an object." };
    const c: Partial<PushSettingsView["categories"]> = {};
    for (const [k, v] of Object.entries(b.categories as Record<string, unknown>)) {
      if (!(CATEGORY_KEYS as readonly string[]).includes(k)) return { ok: false, error: `Unknown category ${k}.` };
      if (typeof v !== "boolean") return { ok: false, error: `${k} must be true or false.` };
      c[k as (typeof CATEGORY_KEYS)[number]] = v;
    }
    update.categories = c;
  }
  if (b.quiet !== undefined) {
    if (!b.quiet || typeof b.quiet !== "object" || Array.isArray(b.quiet)) return { ok: false, error: "quiet must be an object." };
    const q = b.quiet as Record<string, unknown>;
    const out: NonNullable<PushSettingsUpdate["quiet"]> = {};
    for (const k of Object.keys(q)) if (!["enabled", "start", "end", "timezone"].includes(k)) return { ok: false, error: `Unknown quiet hours field ${k}.` };
    if (q.enabled !== undefined) {
      if (typeof q.enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
      out.enabled = q.enabled;
    }
    for (const k of ["start", "end"] as const) {
      if (q[k] !== undefined) {
        if (!isMinute(q[k])) return { ok: false, error: `${k} must be a whole number of minutes from 0 to 1439.` };
        out[k] = q[k] as number;
      }
    }
    if (q.timezone !== undefined) {
      if (!isValidTimeZone(q.timezone)) return { ok: false, error: "That time zone is not valid." };
      out.timezone = q.timezone as string;
    }
    update.quiet = out;
  }
  if (!update.categories && !update.quiet) return { ok: false, error: "Nothing to change." };
  return { ok: true, update };
}

export async function readPushSettings(admin: SupabaseClient, userId: string): Promise<PushSettingsView> {
  const { data, error } = await admin.from("profiles").select(PUSH_PREF_COLUMNS).eq("id", userId).maybeSingle();
  if (error) {
    const old = await admin.from("profiles").select("id,marketing_push_enabled").eq("id", userId).maybeSingle();
    return toView(prefsFromRow(old.data as { id: string; marketing_push_enabled?: boolean | null } | null));
  }
  return toView(prefsFromRow(data as Parameters<typeof prefsFromRow>[0]));
}

/** Writes the update to the profile (and the marketing choice to the player's devices, like the existing switch does). */
export async function savePushSettings(admin: SupabaseClient, userId: string, u: PushSettingsUpdate, nowIso: string = new Date().toISOString()): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {};
  const c = u.categories ?? {};
  if (c.games !== undefined) patch.push_cat_games = c.games;
  if (c.reminders !== undefined) patch.push_cat_reminders = c.reminders;
  if (c.results !== undefined) patch.push_cat_results = c.results;
  if (c.chat !== undefined) patch.push_cat_chat = c.chat;
  if (c.fields !== undefined) patch.push_cat_fields = c.fields;
  if (c.marketing !== undefined) patch.marketing_push_enabled = c.marketing;
  const q = u.quiet ?? {};
  if (q.enabled !== undefined) patch.quiet_hours_enabled = q.enabled;
  if (q.start !== undefined) patch.quiet_hours_start = q.start;
  if (q.end !== undefined) patch.quiet_hours_end = q.end;
  if (q.timezone !== undefined) patch.quiet_hours_tz = q.timezone;
  if (Object.keys(patch).length === 0) return { ok: true };
  const up = await admin.from("profiles").update(patch).eq("id", userId).select("id");
  if (up.error) return { ok: false, error: /push_cat_|quiet_hours/.test(up.error.message ?? "") ? "Notification settings are not available yet." : "We couldn’t save that." };
  if (!(up.data ?? []).length) return { ok: false, error: "We couldn’t find your profile." };
  if (c.marketing !== undefined) await admin.from("user_push_devices").update({ marketing_push_enabled: c.marketing, updated_at: nowIso }).eq("user_id", userId);
  return { ok: true };
}
