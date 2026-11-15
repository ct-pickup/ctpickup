import type { SupabaseClient } from "@supabase/supabase-js";
import { isKnockoutStage } from "@/lib/tournament/bracketLogic";

/**
 * Generate Groups and Generate Knockout delete matches. Neither may do that to scored matches without the admin saying so: the route
 * refuses (409, code "confirm_required") unless the request carries confirm_wipe: true, and the app shows the message below in a
 * confirm before sending it. The message is built here, so the server and the phone say the same thing.
 */

export type WipeSummary = {
  /** Every match of the tournament, scored or not. */
  total_matches: number;
  /** Matches with a result (a bye has none). */
  scored_matches: number;
  groups: number;
  /** The qf, sf and final matches. */
  knockout_matches: number;
  scored_knockout: number;
};

export const CONFIRM_REQUIRED_CODE = "confirm_required";

type MatchRow = { stage?: string | null; completed_at?: string | null; is_bye?: boolean | null };

/** Pure: the counts from the tournament's matches and groups. */
export function summarizeWipe(matches: readonly MatchRow[], groups: number): WipeSummary {
  const scored = (m: MatchRow) => !!m.completed_at && m.is_bye !== true;
  const ko = matches.filter((m) => isKnockoutStage(String(m.stage ?? "")));
  return {
    total_matches: matches.length,
    scored_matches: matches.filter(scored).length,
    groups,
    knockout_matches: ko.length,
    scored_knockout: ko.filter(scored).length,
  };
}

export async function loadWipeSummary(admin: SupabaseClient, tournamentId: string): Promise<WipeSummary> {
  const m = await admin.from("tournament_matches").select("stage,completed_at,is_bye").eq("tournament_id", tournamentId);
  const g = await admin.from("tournament_groups").select("id").eq("tournament_id", tournamentId);
  return summarizeWipe(((m.error ? [] : m.data) ?? []) as MatchRow[], ((g.error ? [] : g.data) ?? []).length);
}

/** Generate Groups replaces everything: it needs a yes when any match or any group already exists. */
export function groupsNeedConfirm(s: WipeSummary): boolean {
  return s.total_matches > 0 || s.groups > 0;
}

/** Generate Knockout replaces the qf, sf and final matches: it needs a yes when any of them has a result. */
export function knockoutNeedsConfirm(s: WipeSummary): boolean {
  return s.scored_knockout > 0;
}

const matches = (n: number) => (n === 1 ? "1 scored match" : `${n} scored matches`);

export function groupsWipeMessage(s: WipeSummary): string {
  const rest = "Every match, the group tables and any knockout matches are removed and the groups are drawn again.";
  if (s.scored_matches > 0) return `This deletes ${matches(s.scored_matches)} and cannot be undone. ${rest}`;
  return `This deletes ${s.total_matches === 1 ? "the 1 existing match" : `the ${s.total_matches} existing matches`} and the groups and cannot be undone. Nothing has a score yet. ${rest}`;
}

export function knockoutWipeMessage(s: WipeSummary): string {
  return `This deletes ${matches(s.scored_knockout)} of the knockout and cannot be undone. The knockout is created again from the group tables.`;
}
