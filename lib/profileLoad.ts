import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROFILE_IDENTITY_SELECT,
  PROFILE_IDENTITY_VIEW,
  PROFILE_SELECT,
  PROFILE_SELECT_MINIMAL,
  type ProfileRow,
} from "@/lib/profileFields";

export function isMissingProfileColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /column .* does not exist/i.test(message) ||
    /Could not find the .* column/i.test(message) ||
    /schema cache/i.test(message) ||
    /\bPGRST204\b/i.test(message) ||
    /\b42703\b/.test(message) ||
    /undefined_column/i.test(message)
  );
}

/** Short line for inline toasts (avoid overwhelming players). */
export const PROFILE_SCHEMA_OUTDATED_MESSAGE =
  "Account storage is missing the latest profile fields. Ask an admin to update the database, then refresh.";

/** Staff / developers: how to fix missing `profiles` esports-related columns. */
export const PROFILE_SCHEMA_DEV_HINT =
  "Staff / developers: run `supabase db push` from the repo, or apply the SQL migrations under `supabase/migrations/` for `profiles` esports fields (files starting with `20260411120000` and `20260415120000`).";

/**
 * Full message: short user-facing line + staff/dev migration hint.
 * Use with `whitespace-pre-line` in UI. Covers PostgREST/Postgres “missing column” responses
 * matched by {@link isMissingProfileColumnError}.
 */
export function profileSchemaMismatchUserMessage(): string {
  return `${PROFILE_SCHEMA_OUTDATED_MESSAGE}\n\n${PROFILE_SCHEMA_DEV_HINT}`;
}

export type ProfileLoadResult = {
  row: ProfileRow | null;
  error: string | null;
  /** False when we fell back to a minimal select because esports columns are missing. */
  hasEsportsSchema: boolean;
};

function emptyEsportsFields(): Pick<
  ProfileRow,
  | "esports_interest"
  | "esports_platform"
  | "esports_console"
  | "esports_online_id"
  | "plays_goalie"
> {
  return {
    esports_interest: null,
    esports_platform: null,
    esports_console: null,
    esports_online_id: null,
    plays_goalie: null,
  };
}

type Identity = Pick<ProfileRow, "sex" | "gender" | "gender_other">;

/**
 * The signed-in player's own sex, gender and gender_other, from the view my_profile_identity (never from `profiles`).
 * If the view does not exist yet, or the read fails, the values are null and the page keeps working.
 */
export async function loadOwnIdentity(supabase: SupabaseClient): Promise<Identity> {
  const res = await supabase.from(PROFILE_IDENTITY_VIEW).select(PROFILE_IDENTITY_SELECT).maybeSingle();
  const d = (res.error ? null : res.data) as Partial<Identity> | null;
  return { sex: d?.sex ?? null, gender: d?.gender ?? null, gender_other: d?.gender_other ?? null };
}

/**
 * Load `profiles` for a user. If esports columns are missing on the database, falls back to a
 * minimal select so the app keeps working and can show a migration notice.
 */
export async function loadProfileRowForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileLoadResult> {
  const full = await supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle();

  if (!full.error) {
    const base = full.data as Omit<ProfileRow, keyof Identity> | null;
    return { row: base ? { ...base, ...(await loadOwnIdentity(supabase)) } : null, error: null, hasEsportsSchema: true };
  }

  if (!isMissingProfileColumnError(full.error.message)) {
    return { row: null, error: full.error.message, hasEsportsSchema: true };
  }

  const mini = await supabase
    .from("profiles")
    .select(PROFILE_SELECT_MINIMAL)
    .eq("id", userId)
    .maybeSingle();

  if (mini.error) {
    return { row: null, error: mini.error.message, hasEsportsSchema: false };
  }

  const base = mini.data as Omit<
    ProfileRow,
    keyof Identity
    | "esports_interest" | "esports_platform" | "esports_console" | "esports_online_id" | "plays_goalie"
  > | null;

  if (!base) {
    return { row: null, error: null, hasEsportsSchema: false };
  }

  return {
    row: { ...base, ...(await loadOwnIdentity(supabase)), ...emptyEsportsFields() },
    error: null,
    hasEsportsSchema: false,
  };
}
