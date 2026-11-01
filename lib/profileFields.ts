/**
 * Columns for authenticated profile UI.
 * `profiles.full_name` is not in the live schema (see migrations + API usage: names are first/last).
 */
/**
 * sex, gender and gender_other are NOT in these lists on purpose: nothing selects them from `profiles` directly. A signed-in
 * player reads their own values from the view `my_profile_identity` (see PROFILE_IDENTITY_VIEW and lib/profileLoad.ts).
 */
export const PROFILE_SELECT_MINIMAL =
  "first_name,last_name,playing_position,username,phone,instagram,avatar_url,tier" as const;

/** The signed-in player's own sex, gender and gender_other: one row at most (id = auth.uid()). Created by 20261103000050_my_profile_identity_view.sql. */
export const PROFILE_IDENTITY_VIEW = "my_profile_identity" as const;
export const PROFILE_IDENTITY_SELECT = "sex,gender,gender_other" as const;

export const PROFILE_SELECT =
  "first_name,last_name,playing_position,username,phone,instagram,avatar_url,tier,esports_interest,esports_platform,esports_console,esports_online_id,plays_goalie" as const;

export type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  sex: string | null;
  gender: string | null;
  gender_other: string | null;
  playing_position: string | null;
  username: string | null;
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

/** All-null row for client state when no profile is loaded yet (e.g. after avatar upload before refetch). */
export const EMPTY_PROFILE_ROW: ProfileRow = {
  first_name: null,
  last_name: null,
  sex: null,
  gender: null,
  gender_other: null,
  playing_position: null,
  username: null,
  phone: null,
  instagram: null,
  avatar_url: null,
  tier: null,
  esports_interest: null,
  esports_platform: null,
  esports_console: null,
  esports_online_id: null,
  plays_goalie: null,
};

export function profileDisplayName(row: ProfileRow | null): string {
  const combined = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return combined;
}
