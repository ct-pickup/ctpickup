/**
 * Columns for authenticated profile UI.
 * `profiles.full_name` is not in the live schema (see migrations + API usage: names are first/last).
 */
export const PROFILE_SELECT_MINIMAL =
  "first_name,last_name,gender,gender_other,playing_position,phone,instagram,avatar_url,tier" as const;

export const PROFILE_SELECT =
  "first_name,last_name,gender,gender_other,playing_position,phone,instagram,avatar_url,tier,esports_interest,esports_platform,esports_console,esports_online_id,plays_goalie" as const;

export type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  gender_other: string | null;
  playing_position: string | null;
  phone: string | null;
  instagram: string | null;
  avatar_url: string | null;
  tier: string | null;
  esports_interest: string | null;
  esports_platform: string | null;
  esports_console: string | null;
  esports_online_id: string | null;
  plays_goalie: boolean | null;
};

export function profileDisplayName(row: ProfileRow | null): string {
  const combined = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return combined;
}
