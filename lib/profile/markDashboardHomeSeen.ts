import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureProfileRowForAuthUser } from "@/lib/profile/ensureProfileRowForAuthUser";
import { isMissingProfileColumnError } from "@/lib/profileLoad";
import { trySupabaseService } from "@/lib/supabase/service";

const now = () => new Date().toISOString();

/**
 * Persists that the user has completed the first-run hub experience (member home / dashboard).
 * Prefer service role when available (bypasses RLS); otherwise pass a user-scoped server client.
 * Ensures a profile row exists before updating (covers users without a trigger-created row).
 */
export async function markDashboardHomeSeen(
  userId: string,
  userScoped?: SupabaseClient | null,
  userHint?: { email?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const payload = { has_seen_dashboard_home: true, updated_at: now() };

  const svc = trySupabaseService();
  if (svc) {
    await ensureProfileRowForAuthUser({ id: userId, email: userHint?.email ?? null });
    const { error } = await svc.from("profiles").update(payload).eq("id", userId);
    if (error) {
      if (isMissingProfileColumnError(error.message)) return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (userScoped) {
    const { error } = await userScoped.from("profiles").update(payload).eq("id", userId);
    if (error) {
      if (isMissingProfileColumnError(error.message)) return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  return { ok: false, error: "No Supabase client available" };
}
