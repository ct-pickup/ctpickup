import {
  PROFILE_USERNAME_MAX_LEN,
  slugUsernameBaseFromNames,
} from "./profileIdentityFields";

/** Structural type so mobile + web can pass their Supabase client without cross-package generic clashes. */
export type ProfileUsernameAllocationClient = {
  from: (table: string) => any;
};

async function usernameTakenByOther(
  client: ProfileUsernameAllocationClient,
  candidate: string,
  excludeUserId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .ilike("username", candidate)
    .neq("id", excludeUserId)
    .maybeSingle();
  if (error) {
    console.warn("[usernameTakenByOther] query error:", error.message ?? error);
    return false;
  }
  return Boolean(data?.id);
}

/**
 * Picks the first `base`, `base2`, `base3`, … not used by another profile (case-insensitive).
 */
export async function allocateUniqueProfileUsername(
  client: ProfileUsernameAllocationClient,
  firstName: string,
  lastName: string,
  excludeUserId: string,
): Promise<string> {
  const baseFull = slugUsernameBaseFromNames(firstName, lastName);
  let candidate = baseFull.slice(0, PROFILE_USERNAME_MAX_LEN);
  if (!(await usernameTakenByOther(client, candidate, excludeUserId))) {
    return candidate;
  }
  for (let n = 2; n < 100_000; n++) {
    const suffix = String(n);
    const room = PROFILE_USERNAME_MAX_LEN - suffix.length;
    const truncated = baseFull.slice(0, Math.max(1, room));
    candidate = (truncated + suffix).slice(0, PROFILE_USERNAME_MAX_LEN);
    if (!(await usernameTakenByOther(client, candidate, excludeUserId))) {
      return candidate;
    }
  }
  return candidate;
}
