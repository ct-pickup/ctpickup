import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isKnockoutStage,
  planAdvancement,
  STAGE_LABEL,
  validateScoreEntry,
  type AdvancementPlan,
  type BracketMatch,
  type KnockoutStage,
} from "@/lib/tournament/bracketLogic";
import { recalculateOutdoorGroupStandings } from "@/lib/tournament/recalculateOutdoorGroupStandings";

export type GoalInput = { team_id: string; scorer_name: string; minute: unknown; is_own_goal?: boolean };

export type LogScoreInput = {
  tournament_id: string;
  match_id: string;
  score_a: unknown;
  score_b: unknown;
  /** Required by the rules when a knockout match is level. */
  winner_id?: unknown;
  goals?: GoalInput[] | null;
  /** The admin agreed to wipe later matches whose teams change because of this edit. */
  confirm_reset?: boolean;
  /**
   * Called with the ids of later matches this edit is about to delete or reset, BEFORE anything is removed (rated tournaments take their
   * rating effect back out here: deleting a match would drop the link to its record).
   */
  beforeApply?: (matchIds: string[]) => Promise<void>;
};

export type LogScoreOutcome =
  | {
      ok: true;
      first_completion: boolean;
      winner_id: string | null;
      won_on_penalties: boolean;
      advanced: { created: number; updated: number; removed: number };
      warnings: string[];
      match: BracketMatch;
    }
  | { ok: false; status: number; code: string; error: string; affected?: string[] };

const MATCH_COLUMNS = "id, tournament_id, stage, group_name, match_number, team_a_id, team_b_id, score_a, score_b, winner_id, is_bye, scheduled_at, started_at, completed_at";

function describe(m: { stage: string; match_number: number }): string {
  return isKnockoutStage(m.stage) ? `${STAGE_LABEL[m.stage]} ${((m.match_number % 1000) + 1)}` : `Match ${m.match_number}`;
}

/** Applies the matches' later-round changes. Auxiliary rows (goals, MVP votes) of removed or reset matches go first. */
async function applyPlan(admin: SupabaseClient, tournamentId: string, plan: AdvancementPlan, nowIso: string): Promise<string | null> {
  const clearIds = [...plan.deletes, ...plan.updates.filter((u) => u.reset).map((u) => u.id)];
  if (clearIds.length) {
    // These tables may not exist everywhere; a failure here shows up as a failure of the delete or update below.
    await admin.from("tournament_match_goals").delete().in("match_id", clearIds);
    await admin.from("tournament_mvp_votes").delete().in("match_id", clearIds);
  }
  if (plan.deletes.length) {
    const { error } = await admin.from("tournament_matches").delete().in("id", plan.deletes);
    if (error) return error.message;
  }
  for (const u of plan.updates) {
    const patch: Record<string, unknown> = { team_a_id: u.team_a_id, team_b_id: u.team_b_id, is_bye: u.is_bye };
    if (u.is_bye) {
      Object.assign(patch, { winner_id: u.team_a_id, score_a: null, score_b: null, completed_at: nowIso, started_at: null });
    } else if (u.reset) {
      Object.assign(patch, { winner_id: null, score_a: null, score_b: null, completed_at: null, started_at: null });
    }
    const { error } = await admin.from("tournament_matches").update(patch).eq("id", u.id);
    if (error) return error.message;
  }
  for (const c of plan.creates) {
    const row: Record<string, unknown> = {
      tournament_id: tournamentId,
      stage: c.stage satisfies KnockoutStage,
      match_number: c.match_number,
      team_a_id: c.team_a_id,
      team_b_id: c.team_b_id,
      is_bye: c.is_bye,
      winner_id: c.is_bye ? c.team_a_id : null,
      completed_at: c.is_bye ? nowIso : null,
    };
    const { error } = await admin.from("tournament_matches").insert(row);
    if (error) return error.message;
  }
  return null;
}

/**
 * One admin action for a score: saves the score, sets the winner and completed_at, rebuilds group standings, and moves the
 * winner into the next knockout match. Editing a score re-does all of that from the stored results. A knockout match that is
 * level needs the winner named (penalties). Nothing is written until every check, including the reset question, has passed.
 */
export async function logMatchScore(admin: SupabaseClient, input: LogScoreInput): Promise<LogScoreOutcome> {
  const all = await admin.from("tournament_matches").select(MATCH_COLUMNS).eq("tournament_id", input.tournament_id);
  if (all.error) return { ok: false, status: 500, code: "load_failed", error: all.error.message };
  const matches = (all.data ?? []) as unknown as BracketMatch[];
  const match = matches.find((m) => String(m.id) === String(input.match_id));
  if (!match) return { ok: false, status: 404, code: "not_found", error: "Match not found" };

  const entry = validateScoreEntry({
    stage: match.stage,
    team_a_id: match.team_a_id,
    team_b_id: match.team_b_id,
    is_bye: match.is_bye,
    score_a: input.score_a,
    score_b: input.score_b,
    winner_id: input.winner_id,
  });
  if (!entry.ok) return { ok: false, status: 400, code: entry.code, error: entry.error };

  const nowIso = new Date().toISOString();
  const firstCompletion = match.completed_at == null;
  const completedAt = match.completed_at ?? nowIso;
  const updated: BracketMatch = {
    ...match,
    score_a: entry.score_a,
    score_b: entry.score_b,
    winner_id: entry.winner_id,
    completed_at: completedAt,
  };

  const plan = planAdvancement(matches.map((m) => (m.id === match.id ? updated : m)));
  if (plan.destructive.length && input.confirm_reset !== true) {
    const byId = new Map(matches.map((m) => [m.id, m]));
    return {
      ok: false,
      status: 409,
      code: "confirm_reset",
      error: "Changing this result changes who plays later matches that already have a result. Saving will clear those results.",
      affected: plan.destructive.map((d) => describe(byId.get(d.id) ?? d)),
    };
  }

  const { error: upErr } = await admin
    .from("tournament_matches")
    .update({ score_a: entry.score_a, score_b: entry.score_b, winner_id: entry.winner_id, completed_at: completedAt })
    .eq("id", match.id);
  if (upErr) return { ok: false, status: 500, code: "save_failed", error: upErr.message };

  await admin.from("tournament_match_goals").delete().eq("match_id", match.id);
  const goals = (input.goals ?? []).filter((g) => g && String(g.scorer_name ?? "").trim());
  if (goals.length) {
    await admin.from("tournament_match_goals").insert(
      goals.map((g) => ({
        match_id: match.id,
        tournament_id: input.tournament_id,
        team_id: g.team_id,
        scorer_name: String(g.scorer_name).trim(),
        minute: g.minute,
        is_own_goal: g.is_own_goal || false,
      })),
    );
  }

  const warnings: string[] = [];
  if (match.stage === "group") {
    const recap = await recalculateOutdoorGroupStandings(admin, input.tournament_id);
    if (!recap.ok) return { ok: false, status: 500, code: "standings_failed", error: recap.error };
    if (matches.some((m) => isKnockoutStage(m.stage))) {
      warnings.push("Knockout matches were already generated from the earlier standings. Generate the knockout again if the qualifiers changed.");
    }
  }

  if (input.beforeApply) {
    const ids = [...plan.deletes, ...plan.updates.filter((u) => u.reset).map((u) => u.id)];
    if (ids.length) await input.beforeApply(ids);
  }

  const planErr = await applyPlan(admin, input.tournament_id, plan, nowIso);
  if (planErr) return { ok: false, status: 500, code: "advance_failed", error: planErr };

  return {
    ok: true,
    first_completion: firstCompletion,
    winner_id: entry.winner_id,
    won_on_penalties: entry.won_on_penalties,
    advanced: {
      created: plan.creates.length,
      updated: plan.updates.length,
      removed: plan.deletes.length,
    },
    warnings,
    match: updated,
  };
}

/** Marks a match as in progress. A match that already has a result stays as it is. */
export async function startMatch(
  admin: SupabaseClient,
  tournamentId: string,
  matchId: string,
): Promise<{ ok: true; started_at: string } | { ok: false; status: number; error: string }> {
  const { data, error } = await admin
    .from("tournament_matches")
    .select("id, tournament_id, team_a_id, team_b_id, is_bye, started_at, completed_at")
    .eq("id", matchId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  const m = data as { tournament_id: string; team_a_id: string | null; team_b_id: string | null; is_bye: boolean | null; started_at: string | null; completed_at: string | null } | null;
  if (!m) return { ok: false, status: 404, error: "Match not found" };
  if (String(m.tournament_id) !== String(tournamentId)) return { ok: false, status: 400, error: "Tournament mismatch" };
  if (m.is_bye || !m.team_a_id || !m.team_b_id) return { ok: false, status: 400, error: "This match has no second team yet." };
  if (m.completed_at) return { ok: false, status: 409, error: "This match already has a result." };
  if (m.started_at) return { ok: true, started_at: m.started_at };
  const startedAt = new Date().toISOString();
  const up = await admin.from("tournament_matches").update({ started_at: startedAt }).eq("id", matchId);
  if (up.error) return { ok: false, status: 500, error: up.error.message };
  return { ok: true, started_at: startedAt };
}
