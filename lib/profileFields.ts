/**
 * Columns for authenticated profile UI.
 * `profiles.full_name` is not in the live schema (see migrations + API usage: names are first/last).
 */
export const PROFILE_SELECT =
  "first_name,last_name,phone,instagram,avatar_url,tier" as const;

export type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  instagram: string | null;
  avatar_url: string | null;
  tier: string | null;
};

export function profileDisplayName(row: ProfileRow | null): string {
  const combined = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return combined;
}
