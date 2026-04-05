import type { User } from "@supabase/supabase-js";

/**
 * Best-effort first name for greetings: `profiles.first_name`, then auth `user_metadata`.
 */
export function resolveWelcomeFirstName(
  profile: { first_name: string | null } | null | undefined,
  user: User
): string {
  const fromProfile = String(profile?.first_name ?? "").trim();
  if (fromProfile) return fromProfile;

  const m = user.user_metadata ?? {};
  const metaFirst = String(m.first_name ?? m.given_name ?? "").trim();
  if (metaFirst) return metaFirst;

  const full = String(m.full_name ?? m.name ?? "").trim();
  if (full) {
    const part = full.split(/\s+/)[0]?.trim();
    if (part) return part;
  }

  return "";
}
