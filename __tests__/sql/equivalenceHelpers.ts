import { readFileSync } from "node:fs";
import { expect } from "vitest";

import { sql, uuid } from "./harness";

/**
 * Proof that the replaced apply_result_rating gives every ordinary (non tournament) game the same answer as the one deployed today
 * (the last definition before 20261106000000: 20261101000300). Both versions run in the same database on identical inputs: game 0 goes
 * through the deployed text (installed here under another name), game 1 through the new function. Their adjustments, signals, expectations
 * and the players' final ratings must match to the last digit. The same is done for refresh_player_game_stats.
 */

const read = (p: string) => readFileSync(new URL(`../../supabase/migrations/${p}`, import.meta.url), "utf8");
export function block(file: string, name: string): string {
  const s = read(file);
  const starts = [...s.matchAll(new RegExp(`create or replace function public\\.${name}\\(`, "g"))].map((m) => m.index!);
  const i = starts[starts.length - 1]!;
  return s.slice(i, s.indexOf("$body$;", s.indexOf("as $body$", i)) + "$body$;".length);
}
export const deployedApply = block("20261101000300_rating_v2_expectations.sql", "apply_result_rating").replace("public.apply_result_rating(", "public.apply_result_rating_deployed(");
export const deployedRefresh = block("20261101000200_player_game_stats.sql", "refresh_player_game_stats").replace("public.refresh_player_game_stats(", "public.refresh_player_game_stats_deployed(");

const HOST = uuid(9900);
export type Spec = {
  scores: number[]; // rating going in, per player; team A is the first half
  sessions?: number;
  winner?: "A" | "B" | null;
  verified?: boolean;
  teamB?: number; // players on team B (defaults to the same as A)
  /** earlier results by the same poster involving player 0, to hit the poster cap */
  earlier?: number;
  /** then flip the winner and apply again (an edit) */
  editTo?: "A" | "B" | null;
  /** after the edit, both captains confirm again (default true). False leaves the result reopened and unverified. */
  reverify?: boolean;
  k?: number;
};

const kFor = (sessions: number) => Math.round(16 * (0.35 + 0.65 * Math.exp(-sessions / 6)) * 100) / 100;

export function game(g: 0 | 1, s: Spec): string {
  const n = s.scores.length;
  const nB = s.teamB ?? Math.floor(n / 2);
  const nA = n - nB;
  const ids = s.scores.map((_, i) => uuid(9000 + g * 100 + i));
  const run = uuid(9500 + g);
  const sess = uuid(9600 + g);
  const k = s.k ?? kFor(s.sessions ?? 0);
  const poster = HOST;
  return `
    insert into auth.users (id) values ${ids.map((p) => `('${p}')`).join(",")};
    insert into public.profiles (id, approved) values ${ids.map((p) => `('${p}', true)`).join(",")};
    insert into public.player_ratings (user_id, score, sessions, reliability) values ${ids.map((p, i) => `('${p}', ${s.scores[i]}, ${s.sessions ?? 0}, 92)`).join(",")};
    insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${run}', 'g${g}', 'completed', now() - interval '2 hours', '${HOST}');
    insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${sess}', '${HOST}', 'v', now() - interval '2 hours', 20, 'settled');
    update public.pickup_runs set tier_session_id = '${sess}' where id = '${run}';
    ${ids.map((p, i) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, peer_weight, k_factor, delta, score_before, score_after) values ('${sess}', '${p}', 0, 0, 0, ${k}, 0, ${s.scores[i]}, ${s.scores[i]});
      insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${run}', '${p}', '${i < nA ? "A" : "B"}');`).join("\n")}
    ${Array.from({ length: s.earlier ?? 0 }, (_, e) => `
      insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(9700 + g * 50 + e)}', 'old', 'completed', now() - interval '3 days', '${poster}');
      insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, created_at) values ('${uuid(9700 + g * 50 + e)}', 2, 'A', '${poster}', now() - interval '${e + 1} hours');
      insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(9700 + g * 50 + e)}', '${ids[0]}', 'A');`).join("\n")}
    insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by${s.verified === false ? "" : ", verified_at"}) values ('${run}', 2, ${s.winner === null ? "null" : `'${s.winner ?? "A"}'`}, '${poster}'${s.verified === false ? "" : ", now()"});
  `;
}

/** What each game's players ended with, in the same order for both games. */
const readout = (g: 0 | 1, n: number, tag: string) => `
  select '${tag}|' || ${g} || '|' || (row_number() over (order by pr.user_id) - 1) || '|' || pr.score || '|' || coalesce(a.delta::text, 'none') || '|' || coalesce(a.result_signal::text, 'none') || '|' || coalesce(a.expected::text, 'none')
    from public.player_ratings pr left join public.rating_result_adjustments a on a.user_id = pr.user_id and a.run_id = '${uuid(9500 + g)}'
   where pr.user_id in (${Array.from({ length: n }, (_, i) => `'${uuid(9000 + g * 100 + i)}'`).join(",")}) order by pr.user_id;`;

export const FLAGS = "update public.app_flags set enabled = true where key in ('rating_v2', 'rating_results');";
/** The two games run through the two functions; the reopen trigger is paused so an edit does not re-run the NEW function on the old game. */
export const HOST_ROWS = `insert into auth.users (id) values ('${HOST}'); insert into public.profiles (id, approved) values ('${HOST}', true);`;
export function pair(s: Spec, deployed: string = deployedApply) {
  const n = s.scores.length;
  const edit =
    s.editTo === undefined
      ? ""
      : `update public.pickup_run_results set winning_team = ${s.editTo === null ? "null" : `'${s.editTo}'`} where run_id in ('${uuid(9500)}', '${uuid(9501)}');
         ${s.reverify === false ? "" : `update public.pickup_run_results set verified_at = now() where run_id in ('${uuid(9500)}', '${uuid(9501)}');`}
         select public.apply_result_rating_deployed('${uuid(9500)}'); select public.apply_result_rating('${uuid(9501)}');
         ${readout(0, n, "after-edit")} ${readout(1, n, "after-edit")}`;
  return `${deployed} ${HOST_ROWS}
    ${game(0, s)} ${game(1, s)} ${FLAGS}
    alter table public.pickup_run_results disable trigger pickup_results_reopened;
    select 'moved|0|' || public.apply_result_rating_deployed('${uuid(9500)}'); select 'moved|1|' || public.apply_result_rating('${uuid(9501)}');
    ${readout(0, n, "first")} ${readout(1, n, "first")} ${edit}`;
}

export function run(s: Spec, deployed: string = deployedApply) {
  const out = sql(pair(s, deployed));
  const pick = (tag: string, g: number) => out.filter((l) => l.startsWith(`${tag}|${g}|`)).map((l) => l.split("|").slice(2).join("|"));
  const moved = (g: number) => out.find((l) => l.startsWith(`moved|${g}|`))!.split("|")[2];
  return { first: [pick("first", 0), pick("first", 1)], edited: [pick("after-edit", 0), pick("after-edit", 1)], moved: [moved(0), moved(1)] };
}
/** A row is `index|rating after|delta|signal|expected`. */
const col = (row: string | undefined, i: number) => row!.split("|")[i]!;
export const ten = (a: number, b: number) => [...Array(5).fill(a), ...Array(5).fill(b)];

export const CASES: Array<[string, Spec, (r: ReturnType<typeof run>) => void]> = [
  ["a new player (first game, k 16), equal teams, team A wins", { scores: ten(50, 50), sessions: 0 }, (r) => expect(r.first[1]![0]).toMatch(/^0\|51\.20\|1\.20\|0\.5000\|0\.5000$/)],
  ["a veteran (40 games, small k), equal teams", { scores: ten(70, 70), sessions: 40 }, (r) => expect(Number(col(r.first[1]![0], 2))).toBeLessThan(0.5)],
  ["an upset: the weaker team (40) beats the stronger (70)", { scores: ten(40, 70), sessions: 3, winner: "A" }, (r) => expect(Number(col(r.first[1]![0], 2))).toBeGreaterThan(1.5)],
  ["a blowout expectation: the much stronger team wins as expected", { scores: ten(80, 30), sessions: 0, winner: "A" }, (r) => expect(Number(col(r.first[1]![0], 2))).toBeLessThan(0.3)],
  ["the 2 point cap: a huge upset would move 2.4, the cap holds it at 2", { scores: ten(10, 90), sessions: 0, winner: "A" }, (r) => { expect(col(r.first[1]![0], 2)).toBe("2.00"); expect(col(r.first[1]![9], 2)).toBe("-2.00"); }],
  ["a rise held below 89.9 without the evidence for the top bands", { scores: ten(89, 89), sessions: 0 }, (r) => expect(col(r.first[1]![0], 1)).toBe("89.90")],
  ["a draw between unequal teams", { scores: ten(60, 50), sessions: 2, winner: null }, (r) => expect(r.first[1]![0]).not.toMatch(/none/)],
  ["an edit: A wins, then the result is changed to B and applied again", { scores: ten(50, 50), sessions: 0, editTo: "B" }, (r) => expect(col(r.edited[1]![0], 2)).toBe("-1.20")],
  ["an edit that is not confirmed again reopens the result and takes its effect back out", { scores: ten(50, 50), editTo: "B", reverify: false }, (r) => expect(col(r.edited[1]![0], 2)).toBe("0.00")],
  ["an edit to a draw", { scores: ten(55, 50), sessions: 1, editTo: null }, () => undefined],
  ["an edit back to the same winner changes nothing", { scores: ten(50, 50), editTo: "A" }, (r) => expect(r.edited[1]).toEqual(r.first[1])],
  ["an unverified result counts for nothing", { scores: ten(50, 50), verified: false }, (r) => expect(r.moved).toEqual(["0", "0"])],
  ["teams that differ by 2 players count for nothing", { scores: [...Array(5).fill(50), ...Array(3).fill(50)], teamB: 3 }, (r) => expect(r.moved).toEqual(["0", "0"])],
  ["fewer than 8 players count for nothing", { scores: Array(6).fill(50) }, (r) => expect(r.moved).toEqual(["0", "0"])],
  ["exactly 8 players (4 v 4) count", { scores: Array(8).fill(50) }, (r) => expect(r.moved).toEqual(["8", "8"])],
  ["teams within 1 player (5 v 4) count", { scores: Array(9).fill(50), teamB: 4 }, (r) => expect(r.moved).toEqual(["9", "9"])],
  ["the poster cap: 7 earlier results by the same poster with player 0 ignore this one for that player", { scores: ten(50, 50), earlier: 7 }, (r) => expect(col(r.first[1]![0], 2)).toBe("none")],
  ["the poster cap is not reached with 5 earlier results", { scores: ten(50, 50), earlier: 5 }, (r) => expect(col(r.first[1]![0], 2)).toBe("1.20")],
];

