import type { SupabaseClient } from "@supabase/supabase-js";

export async function lookupPickupPlayerByUsernameOrEmail(
  admin: SupabaseClient,
  identifier: string,
): Promise<{ user_id: string; full_name: string | null; username: string | null } | null> {
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;

  // Try username first
  const byUsername = await admin
    .from("profiles")
    .select("id, first_name, last_name, username")
    .ilike("username", clean)
    .maybeSingle();

  if (byUsername.data) {
    const p = byUsername.data;
    return {
      user_id: p.id,
      full_name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || null,
      username: p.username || null,
    };
  }

  // Try email via auth.users
  const byEmail = await admin.auth.admin.listUsers();
  const user = (byEmail.data?.users || []).find(
    (u) => u.email?.toLowerCase() === clean,
  );
  if (!user) return null;

  const prof = await admin
    .from("profiles")
    .select("id, first_name, last_name, username")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof.data) return null;
  return {
    user_id: prof.data.id,
    full_name: `${prof.data.first_name || ""} ${prof.data.last_name || ""}`.trim() || null,
    username: prof.data.username || null,
  };
}
