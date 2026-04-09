import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { ensureProfileRowForAuthUser } from "@/lib/profile/ensureProfileRowForAuthUser";
import { isMissingProfileColumnError } from "@/lib/profileLoad";

/**
 * Whether the logged-in user should see the first-run dashboard-style welcome on `/`
 * instead of being redirected to `/dashboard`.
 */
export async function shouldShowFirstRunHomeOnRoot(
  user: User,
  supabase: SupabaseClient,
): Promise<boolean> {
  const read = () =>
    supabase
      .from("profiles")
      .select("has_seen_dashboard_home")
      .eq("id", user.id)
      .maybeSingle();

  let profRes = await read();

  if (profRes.error) {
    if (isMissingProfileColumnError(profRes.error.message)) {
      return true;
    }
    await ensureProfileRowForAuthUser(user);
    profRes = await read();
    if (profRes.error || !profRes.data) {
      return true;
    }
    return profRes.data.has_seen_dashboard_home === false;
  }

  if (!profRes.data) {
    await ensureProfileRowForAuthUser(user);
    profRes = await read();
    if (!profRes.data) {
      return true;
    }
    return profRes.data.has_seen_dashboard_home === false;
  }

  return profRes.data.has_seen_dashboard_home === false;
}
