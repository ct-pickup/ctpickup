import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Remote feature switches (table public.app_flags, migration 20261024000000). A flag is ON for a user when
 *   enabled = true (everyone)  OR  the user's id is in allowlist  OR  the user is an admin.
 * Anything else is OFF, and so is any doubt: no row, no user, a failed read. SQL twin: public.flag_on().
 */

export type FlagKey = "fields" | "paid_plans" | "rating_v2" | "rating_results";
export const FLAG_KEYS: readonly FlagKey[] = ["fields", "paid_plans", "rating_v2", "rating_results"];
export const isFlagKey = (v: unknown): v is FlagKey => typeof v === "string" && (FLAG_KEYS as readonly string[]).includes(v);

export type FlagRow = { enabled?: boolean | null; allowlist?: string[] | null } | null | undefined;

/** The rule, as a pure function. */
export function evaluateFlag(row: FlagRow, userId: string | null | undefined, isAdmin: boolean): boolean {
  if (!userId) return false;
  if (isAdmin) return true;
  if (!row) return false;
  return row.enabled === true || (Array.isArray(row.allowlist) && row.allowlist.includes(userId));
}

/** Reads the flag and the caller's admin bit with the service client. Any error means OFF. */
export async function isFlagOn(admin: SupabaseClient, key: FlagKey, userId: string): Promise<boolean> {
  try {
    const [flag, prof] = await Promise.all([
      admin.from("app_flags").select("enabled,allowlist").eq("key", key).maybeSingle(),
      admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
    ]);
    const isAdmin = !prof.error && (prof.data as { is_admin?: boolean } | null)?.is_admin === true;
    if (flag.error) return isAdmin; // cannot read the switch: only admins keep working
    return evaluateFlag(flag.data as FlagRow, userId, isAdmin);
  } catch {
    return false;
  }
}

/** The response every guarded route sends when the flag is OFF for the caller. */
export const featureOffResponse = (): NextResponse => NextResponse.json({ error: "feature_off" }, { status: 403 });

/** Null when the caller may continue, otherwise the 403 {error: "feature_off"} to return. All of `keys` must be ON. */
export async function requireFlag(admin: SupabaseClient, keys: FlagKey | FlagKey[], userId: string): Promise<NextResponse | null> {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    if (!(await isFlagOn(admin, key, userId))) return featureOffResponse();
  }
  return null;
}

/** Looks a player up by email (case-insensitive) for the allowlist. Returns the user id or null. */
export async function userIdByEmail(admin: SupabaseClient, rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) return null;
  const { data } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (id) return id;
  for (let page = 1; page <= 20; page++) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = list?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}
