/** Pure helpers for the Games tab ("Your season") and the match recap. No React, no Supabase. */
import { outcomeForTeam, scoreLineForTeam, type StoredResult } from "@/lib/pickup/resultOutcome";

export type Outcome = "W" | "L" | "D";

export type TeamScores = Partial<Record<"A" | "B" | "C", number>>;

const ET = "America/New_York";

function toStored(winningTeam: string | null, scores: TeamScores | null | undefined): StoredResult {
  const two = scores != null && scores.C == null && typeof scores.A === "number" && typeof scores.B === "number";
  return { winning_team: winningTeam, score_a: two ? scores.A : null, score_b: two ? scores.B : null };
}

/**
 * Result for the viewer, by the shared result rules: a recorded score decides it (equal is a draw);
 * otherwise `winning_team`, where a posted result with no winner is a draw. Null without a result or a team.
 */
export function outcomeFor(
  myTeam: string | null | undefined,
  result: { winning_team: string | null; scores?: TeamScores | null } | null | undefined,
): Outcome | null {
  if (!result) return null;
  return outcomeForTeam(myTeam, toStored(result.winning_team, result.scores));
}

/** "5–3" from the viewer's side (their team first), only for two-team games with both scores recorded. */
export function scoreLine(myTeam: string | null | undefined, scores: TeamScores | null | undefined): string | null {
  return scoreLineForTeam(myTeam, toStored(null, scores));
}

/** Season record with en dashes: wins–losses ("2–1"), or wins–draws–losses ("2–1–1") once a draw exists. */
export function recordLine(wins: number, losses: number, draws = 0): string {
  return draws > 0 ? `${wins}\u2013${draws}\u2013${losses}` : `${wins}\u2013${losses}`;
}

export function recordCaption(draws = 0): string {
  return draws > 0 ? "Wins \u00b7 Draws \u00b7 Losses" : "Wins \u00b7 Losses";
}

/** Last `n` decided games, oldest on the left and most recent on the right. Input is any order. */
export function formStrip<T extends { start_at: string | null; outcome: Outcome | null }>(games: T[], n = 5): Outcome[] {
  return games
    .filter((g): g is T & { outcome: Outcome } => g.outcome != null)
    .sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")))
    .slice(0, n)
    .reverse()
    .map((g) => g.outcome);
}

function etParts(iso: string): { year: string; month: string; monthShort: string; day: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const get = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: ET, ...opts }).format(d);
  return {
    year: get({ year: "numeric" }),
    month: get({ month: "long" }),
    monthShort: get({ month: "short" }),
    day: get({ day: "numeric" }),
  };
}

/** Stacked date block in Eastern time: { month: "Jul", day: "14" }. */
export function dateBlockEt(iso: string | null | undefined): { month: string; day: string } {
  const p = iso ? etParts(iso) : null;
  return p ? { month: p.monthShort, day: p.day } : { month: "", day: "\u2014" };
}

/** "July 2026" in Eastern time. */
export function monthLabelEt(iso: string | null | undefined): string {
  const p = iso ? etParts(iso) : null;
  return p ? `${p.month} ${p.year}` : "Date TBD";
}

/** "Tue, Jul 14, 2026" in Eastern time. */
export function longDateEt(iso: string | null | undefined): string {
  if (!iso) return "Date TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBD";
  return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Groups newest-first games into month sections, keeping order. */
export function groupByMonthEt<T extends { start_at: string | null }>(games: T[]): Array<{ label: string; games: T[] }> {
  const out: Array<{ label: string; games: T[] }> = [];
  for (const g of games) {
    const label = monthLabelEt(g.start_at);
    const last = out[out.length - 1];
    if (last && last.label === label) last.games.push(g);
    else out.push({ label, games: [g] });
  }
  return out;
}

/** Other players are shown as "Marcus B." only. */
export function privacyName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "Player";
  if (!l) return f;
  if (!f) return `${l[0]!.toUpperCase()}.`;
  return `${f} ${l[0]!.toUpperCase()}.`;
}

export function outcomeWord(o: Outcome): string {
  return o === "W" ? "Win" : o === "L" ? "Loss" : "Draw";
}
