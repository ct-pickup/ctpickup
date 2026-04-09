import type { User } from "@supabase/supabase-js";
import { isMissingProfileColumnError } from "@/lib/profileLoad";
import { trySupabaseService } from "@/lib/supabase/service";

const now = () => new Date().toISOString();

type AuthLike = Pick<User, "id"> & { email?: string | null };

/**
 * Ensures a `profiles` row exists for the auth user (service role).
 * New rows get `has_seen_dashboard_home: false` when the column exists, matching first-run hub behavior.
 */
export async function ensureProfileRowForAuthUser(user: AuthLike): Promise<{ ok: boolean }> {
  const svc = trySupabaseService();
  if (!svc) return { ok: false };

  const { data: existing } = await svc.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (existing) return { ok: true };

  const email = user.email?.trim().toLowerCase() ?? null;
  const ts = now();

  const withSeen = {
    id: user.id,
    email,
    created_at: ts,
    updated_at: ts,
    has_seen_dashboard_home: false as const,
  };

  let err = (await svc.from("profiles").insert(withSeen)).error;
  if (!err) return { ok: true };

  if (isMissingProfileColumnError(err.message)) {
    err = (
      await svc.from("profiles").insert({
        id: user.id,
        email,
        created_at: ts,
        updated_at: ts,
      })
    ).error;
    if (!err) return { ok: true };
  }

  const code = "code" in err && typeof (err as { code?: string }).code === "string"
    ? (err as { code: string }).code
    : "";
  if (code === "23505" || /duplicate key|unique constraint/i.test(err.message ?? "")) {
    return { ok: true };
  }

  return { ok: false };
}
