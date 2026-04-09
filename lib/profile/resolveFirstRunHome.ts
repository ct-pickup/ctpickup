import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { ensureProfileRowForAuthUser } from "@/lib/profile/ensureProfileRowForAuthUser";
import { isMissingProfileColumnError } from "@/lib/profileLoad";

/**
 * First-run hub on `/` vs redirect to `/dashboard`.
 *
 * Production checklist (verify in Supabase / hosting):
 * 1. New auth users get a `profiles` row via trigger `on_auth_user_created_profiles` →
 *    `handle_new_user_profile` (see `20260408120000_profiles_schema.sql`), unless disabled.
 * 2. `has_seen_dashboard_home` defaults to `false` for new rows once migration
 *    `20260408130000_profiles_has_seen_dashboard_home` is applied; pre-migration nulls were
 *    backfilled to `true` (existing users treated as already onboarded).
 * 3. If that migration is not applied, selects on `has_seen_dashboard_home` may error; we treat
 *    missing-column errors as “show first-run on `/`”.
 * 4. Deploy version: compare git SHA / Vercel deployment to your branch (not observable from code).
 * 5. **Critical:** If the user hits `/dashboard` before `/`, `markDashboardHomeSeen` runs there and
 *    sets `has_seen_dashboard_home = true`, so `/` will redirect on the next visit. First-visit
 *    URLs must land on `/` first (see `APP_HOME_FIRST_VISIT_URL` in `lib/siteNav.ts`).
 *
 * Enable server logs: set `FIRST_RUN_HOME_DEBUG=1` in the deployment environment.
 */

export type FirstRunHomeResolution = {
  showFirstRunHomeUi: boolean;
  debug: {
    decision:
      | "missing_column_treat_as_first_run"
      | "read_error_or_no_row_after_ensure_first_run"
      | "has_seen_not_true_first_run"
      | "has_seen_true_redirect";
    profileReadError: string | null;
    profileRowExists: boolean;
    /** Exact DB value when row exists; null if no row or unreadable */
    hasSeenDashboardHome: boolean | null;
  };
};

const readProfileFlag = (supabase: SupabaseClient, userId: string) =>
  supabase
    .from("profiles")
    .select("has_seen_dashboard_home")
    .eq("id", userId)
    .maybeSingle();

/**
 * Full resolution + debug payload for `/` (logged when `FIRST_RUN_HOME_DEBUG=1`).
 */
export async function resolveFirstRunHomeOnRoot(
  user: User,
  supabase: SupabaseClient,
): Promise<FirstRunHomeResolution> {
  let profRes = await readProfileFlag(supabase, user.id);

  if (profRes.error) {
    if (isMissingProfileColumnError(profRes.error.message)) {
      return {
        showFirstRunHomeUi: true,
        debug: {
          decision: "missing_column_treat_as_first_run",
          profileReadError: profRes.error.message,
          profileRowExists: false,
          hasSeenDashboardHome: null,
        },
      };
    }
    await ensureProfileRowForAuthUser(user);
    profRes = await readProfileFlag(supabase, user.id);
    if (profRes.error || !profRes.data) {
      return {
        showFirstRunHomeUi: true,
        debug: {
          decision: "read_error_or_no_row_after_ensure_first_run",
          profileReadError: profRes.error?.message ?? null,
          profileRowExists: false,
          hasSeenDashboardHome: null,
        },
      };
    }
    const v = profRes.data.has_seen_dashboard_home;
    const seen = v === true;
    return {
      showFirstRunHomeUi: !seen,
      debug: {
        decision: seen ? "has_seen_true_redirect" : "has_seen_not_true_first_run",
        profileReadError: null,
        profileRowExists: true,
        hasSeenDashboardHome: typeof v === "boolean" ? v : null,
      },
    };
  }

  if (!profRes.data) {
    await ensureProfileRowForAuthUser(user);
    profRes = await readProfileFlag(supabase, user.id);
    if (!profRes.data) {
      return {
        showFirstRunHomeUi: true,
        debug: {
          decision: "read_error_or_no_row_after_ensure_first_run",
          profileReadError: profRes.error?.message ?? null,
          profileRowExists: false,
          hasSeenDashboardHome: null,
        },
      };
    }
    const v = profRes.data.has_seen_dashboard_home;
    const seen = v === true;
    return {
      showFirstRunHomeUi: !seen,
      debug: {
        decision: seen ? "has_seen_true_redirect" : "has_seen_not_true_first_run",
        profileReadError: null,
        profileRowExists: true,
        hasSeenDashboardHome: typeof v === "boolean" ? v : null,
      },
    };
  }

  const v = profRes.data.has_seen_dashboard_home;
  const seen = v === true;
  return {
    showFirstRunHomeUi: !seen,
    debug: {
      decision: seen ? "has_seen_true_redirect" : "has_seen_not_true_first_run",
      profileReadError: null,
      profileRowExists: true,
      hasSeenDashboardHome: typeof v === "boolean" ? v : null,
    },
  };
}

export async function shouldShowFirstRunHomeOnRoot(
  user: User,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { showFirstRunHomeUi } = await resolveFirstRunHomeOnRoot(user, supabase);
  return showFirstRunHomeUi;
}

export function logFirstRunHomeDebug(payload: {
  path: string;
  supabaseAvailable: boolean;
  authUserPresent: boolean;
  userId: string | null;
  email: string | null;
  resolution: FirstRunHomeResolution | null;
  outcome: "public_marketing_home" | "first_run_dashboard_ui" | "redirect_dashboard";
}): void {
  if (process.env.FIRST_RUN_HOME_DEBUG !== "1") return;

  console.log(
    "[first-run-home]",
    JSON.stringify(
      {
        ...payload,
        resolution: payload.resolution
          ? {
              showFirstRunHomeUi: payload.resolution.showFirstRunHomeUi,
              debug: payload.resolution.debug,
            }
          : null,
      },
      null,
      2,
    ),
  );
}
