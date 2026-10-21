import type { SupabaseClient } from "@supabase/supabase-js";

import { FLAG_KEYS, isFlagKey, userIdByEmail, type FlagKey } from "@/lib/flags";

/** Admin-side reads and writes of public.app_flags. Service client only. Every change is written to public.app_flag_events. */

export type AllowedUser = { id: string; email: string | null };
export type FlagView = { key: FlagKey; enabled: boolean; note: string | null; updated_at: string | null; allowlist: AllowedUser[] };
export type FlagEvent = { id: number; flag_key: string; actor_id: string | null; actor_email: string | null; change: Record<string, unknown>; created_at: string };

type Row = { key: string; enabled: boolean | null; allowlist: string[] | null; note: string | null; updated_at: string | null };

async function emailOf(admin: SupabaseClient, id: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(id);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function listFlags(admin: SupabaseClient): Promise<{ flags: FlagView[]; events: FlagEvent[] }> {
  const { data, error } = await admin.from("app_flags").select("key,enabled,allowlist,note,updated_at");
  if (error) throw new Error(error.message);
  const rows = new Map(((data ?? []) as Row[]).map((r) => [r.key, r]));
  const flags: FlagView[] = [];
  for (const key of FLAG_KEYS) {
    const r = rows.get(key);
    const ids = r?.allowlist ?? [];
    const allowlist = await Promise.all(ids.slice(0, 100).map(async (id) => ({ id, email: await emailOf(admin, id) })));
    flags.push({ key, enabled: r?.enabled === true, note: r?.note ?? null, updated_at: r?.updated_at ?? null, allowlist });
  }
  const ev = await admin.from("app_flag_events").select("id,flag_key,actor_id,change,created_at").order("created_at", { ascending: false }).limit(20);
  const events = await Promise.all(((ev.data ?? []) as Omit<FlagEvent, "actor_email">[]).map(async (e) => ({ ...e, actor_email: e.actor_id ? await emailOf(admin, e.actor_id) : null })));
  return { flags, events };
}

export type FlagChange = { key: unknown; enabled?: unknown; add_email?: unknown; remove_id?: unknown };
export type ChangeResult = { ok: true; flag: FlagView } | { ok: false; status: number; error: string };

/** Turns the switch on or off for everyone, and/or adds a player (by email) to or removes one from the allowlist. */
export async function changeFlag(admin: SupabaseClient, actorId: string, input: FlagChange): Promise<ChangeResult> {
  if (!isFlagKey(input.key)) return { ok: false, status: 400, error: "Unknown flag." };
  const key = input.key;
  const { data: cur, error: readErr } = await admin.from("app_flags").select("key,enabled,allowlist,note").eq("key", key).maybeSingle();
  if (readErr) return { ok: false, status: 500, error: "Could not read the flag. Has the app_flags migration been run?" };
  const before = (cur as Row | null) ?? { key, enabled: false, allowlist: [], note: null, updated_at: null };
  let enabled = before.enabled === true;
  let allowlist = [...(before.allowlist ?? [])];
  const change: Record<string, unknown> = {};

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return { ok: false, status: 400, error: "enabled must be true or false." };
    if (input.enabled !== enabled) change.enabled = { from: enabled, to: input.enabled };
    enabled = input.enabled;
  }
  if (input.add_email !== undefined && input.add_email !== "") {
    if (typeof input.add_email !== "string") return { ok: false, status: 400, error: "add_email must be an email address." };
    const id = await userIdByEmail(admin, input.add_email);
    if (!id) return { ok: false, status: 404, error: "No player has that email address." };
    if (!allowlist.includes(id)) {
      allowlist.push(id);
      change.added = { id, email: input.add_email.trim().toLowerCase() };
    }
  }
  if (input.remove_id !== undefined && input.remove_id !== "") {
    if (typeof input.remove_id !== "string") return { ok: false, status: 400, error: "remove_id must be a user id." };
    if (allowlist.includes(input.remove_id)) {
      allowlist = allowlist.filter((x) => x !== input.remove_id);
      change.removed = { id: input.remove_id };
    }
  }
  if (Object.keys(change).length === 0) return { ok: true, flag: await viewOf(admin, key, enabled, allowlist, before.note, before.updated_at) };

  const updatedAt = new Date().toISOString();
  const { error: wErr } = await admin.from("app_flags").upsert({ key, enabled, allowlist, updated_at: updatedAt }, { onConflict: "key" });
  if (wErr) return { ok: false, status: 500, error: "Could not save the flag." };
  await admin.from("app_flag_events").insert({ flag_key: key, actor_id: actorId, change });
  return { ok: true, flag: await viewOf(admin, key, enabled, allowlist, before.note, updatedAt) };
}

async function viewOf(admin: SupabaseClient, key: FlagKey, enabled: boolean, ids: string[], note: string | null, updated_at: string | null): Promise<FlagView> {
  return { key, enabled, note, updated_at, allowlist: await Promise.all(ids.map(async (id) => ({ id, email: await emailOf(admin, id) }))) };
}
