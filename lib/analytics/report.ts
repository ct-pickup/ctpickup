/**
 * Turns the metrics views (migration 20261026000200) into what the admin screen shows. Pure, so it is tested without a database.
 * Numbers come from the views as they are; this adds the two things a view cannot say: the headline rate over finished cohorts,
 * and the single biggest drop in the first-game funnel.
 */

export type FunnelRow = { step_order: number; step: string; label: string; players: number };
export type SecondGameRow = { cohort_week: string; players: number; returned: number; rate_pct: number | null; mature: boolean };
export type CohortCell = { cohort_week: string; week_offset: number; cohort_size: number; active: number; rate_pct: number | null };

export type BiggestDrop = { from_label: string; to_label: string; from_players: number; to_players: number; lost: number; drop_pct: number };

/** A step needs this many players before it can be called "the biggest drop". Below that the numbers are noise. */
export const MIN_PLAYERS_FOR_DROP = 5;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeFunnel(rows: unknown): FunnelRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ step_order: num((r as FunnelRow).step_order), step: String((r as FunnelRow).step ?? ""), label: String((r as FunnelRow).label ?? ""), players: num((r as FunnelRow).players) }))
    .filter((r) => r.step)
    .sort((a, b) => a.step_order - b.step_order);
}

/**
 * The step where the most players are lost, as a share of the step before it.
 * Steps with 0 players are skipped (the app steps have no data while usage sharing is off), so "Approved to Joined a game" can be
 * the answer. A step that is bigger than the one before it (a free game joins without a "started" step) counts as no loss.
 * Returns null when there are fewer than two steps with data or the first step is too small to mean anything.
 */
export function biggestDrop(funnel: FunnelRow[]): BiggestDrop | null {
  const withData = funnel.filter((s) => s.players > 0);
  if (withData.length < 2 || withData[0]!.players < MIN_PLAYERS_FOR_DROP) return null;
  let best: BiggestDrop | null = null;
  for (let i = 1; i < withData.length; i++) {
    const from = withData[i - 1]!;
    const to = withData[i]!;
    if (from.players < MIN_PLAYERS_FOR_DROP) continue;
    const lost = Math.max(0, from.players - to.players);
    const drop_pct = Math.round((1000 * lost) / from.players) / 10;
    if (!best || drop_pct > best.drop_pct) best = { from_label: from.label, to_label: to.label, from_players: from.players, to_players: to.players, lost, drop_pct };
  }
  return best && best.lost > 0 ? best : null;
}

/** The second-game rate over cohorts whose 30 days are over, so a young week does not drag it down. Null with no finished cohort. */
export function headlineSecondGame(rows: SecondGameRow[]): { rate_pct: number; players: number; returned: number; weeks: number } | null {
  const done = rows.filter((r) => r.mature && r.players > 0);
  const players = done.reduce((s, r) => s + r.players, 0);
  if (!players) return null;
  const returned = done.reduce((s, r) => s + r.returned, 0);
  return { rate_pct: Math.round((1000 * returned) / players) / 10, players, returned, weeks: done.length };
}

export function normalizeSecondGame(rows: unknown): SecondGameRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    cohort_week: String((r as SecondGameRow).cohort_week ?? "").slice(0, 10),
    players: num((r as SecondGameRow).players),
    returned: num((r as SecondGameRow).returned),
    rate_pct: (r as SecondGameRow).rate_pct == null ? null : num((r as SecondGameRow).rate_pct),
    mature: (r as SecondGameRow).mature === true,
  }));
}

export function normalizeCohorts(rows: unknown): CohortCell[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    cohort_week: String((r as CohortCell).cohort_week ?? "").slice(0, 10),
    week_offset: num((r as CohortCell).week_offset),
    cohort_size: num((r as CohortCell).cohort_size),
    active: num((r as CohortCell).active),
    rate_pct: (r as CohortCell).rate_pct == null ? null : num((r as CohortCell).rate_pct),
  }));
}

export type RetentionReport = {
  generated_at: string;
  funnel: FunnelRow[];
  biggest_drop: BiggestDrop | null;
  /** False while no app-side events exist, so the screen can say why the middle of the funnel is empty. */
  has_app_steps: boolean;
  second_game: SecondGameRow[];
  second_game_headline: ReturnType<typeof headlineSecondGame>;
  cohorts: CohortCell[];
  run_health: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
};

export function buildRetentionReport(raw: {
  funnel: unknown;
  second_game: unknown;
  cohorts: unknown;
  run_health: unknown;
  notifications: unknown;
}, now = new Date()): RetentionReport {
  const funnel = normalizeFunnel(raw.funnel);
  const second_game = normalizeSecondGame(raw.second_game);
  return {
    generated_at: now.toISOString(),
    funnel,
    biggest_drop: biggestDrop(funnel),
    has_app_steps: funnel.some((s) => ["run_list_viewed", "run_viewed", "rsvp_started"].includes(s.step) && s.players > 0),
    second_game,
    second_game_headline: headlineSecondGame(second_game),
    cohorts: normalizeCohorts(raw.cohorts),
    run_health: Array.isArray(raw.run_health) ? (raw.run_health as Record<string, unknown>[]) : [],
    notifications: Array.isArray(raw.notifications) ? (raw.notifications as Record<string, unknown>[]) : [],
  };
}
