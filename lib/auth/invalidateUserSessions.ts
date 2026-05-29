import type { SupabaseClient } from "@supabase/supabase-js";

/** Revokes all refresh tokens / sessions for a user (global sign-out). */
export async function invalidateUserSessions(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.auth.admin.signOut(userId, "global");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
