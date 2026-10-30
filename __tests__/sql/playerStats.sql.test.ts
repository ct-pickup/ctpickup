import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const HOST = uuid(950);
const RUN = uuid(960);
const TS = uuid(970);
const players = Array.from({ length: 10 }, (_, i) => ({ id: uuid(1000 + i), score: 40 + i * 4, team: i % 2 === 0 ? "A" : "B" }));
const A = players.filter((p) => p.team === "A");
const B = players.filter((p) => p.team === "B");

/** A settled 10 player game (scores 40..76, evens on A) with the result row posted, unverified. */
function game(winner: "A" | "B" | "draw" = "A", extra = "") {
  return `
    do $$ begin if to_regprocedure('auth.role()') is null then
      create function auth.role() returns text language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), ''service_role'')';
    end if; end $$;
    alter table public.pickup_runs add column if not exists tier_session_id uuid;
    insert into auth.users (id) values ('${HOST}'), ${players.map((p) => `('${p.id}')`).join(",")};
    insert into public.profiles (id, approved) values ('${HOST}', true), ${players.map((p) => `('${p.id}', true)`).join(",")};
    insert into public.player_ratings (user_id, score, sessions, reliability) values ${players.map((p) => `('${p.id}', ${p.score}, 5, 92)`).join(",")};
    insert into public.pickup_runs (id, title, start_at, capacity, status, created_by) values ('${RUN}', 'g', now() - interval '2 hours', 14, 'completed', '${HOST}');
    insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${TS}', '${HOST}', 'v', now() - interval '2 hours', 20, 'open');
    update public.pickup_runs set tier_session_id = '${TS}' where id = '${RUN}';
    insert into public.session_attendance (session_id, user_id, status, organizer_score) values ${players.map((p) => `('${TS}', '${p.id}', 'attended', 5)`).join(",")};
    ${players.map((p, i) => `insert into public.pickup_run_team_assignments (run_id, user_id, team, created_at) values ('${RUN}', '${p.id}', '${p.team}', now() - interval '1 hour' + interval '${i} seconds');`).join("\n")}
    ${extra}
    select public.settle_session('${TS}');
    insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by) values ('${RUN}', 2, ${winner === "draw" ? "null" : `'${winner}'`}, '${HOST}');
  `;
}
const confirmBoth = `insert into public.pickup_run_result_confirmations (run_id, team, result_version, confirmed_by) values
  ('${RUN}', 'A', 1, '${A[0]!.id}'), ('${RUN}', 'B', 1, '${B[0]!.id}');
  update public.app_flags set enabled = true where key in ('rating_v2', 'rating_results');`;
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;

describe.skipIf(!SQL_TESTS_ENABLED)("player game stats and the profile view (real Postgres)", () => {
  it("partner and opponent averages come from the scores going into the game, partners excluding the player", () => {
    const out = sql(`${game()} select user_id || '|' || partner_avg || '|' || opponent_avg || '|' || team from public.player_game_stats where run_id = '${RUN}' order by user_id;`).filter((l) => l.includes("|"));
    expect(out).toHaveLength(10);
    const scoreBefore = new Map(players.map((p) => [p.id, p.score]));
    for (const line of out) {
      const [id, partner, opp, team] = line.split("|");
      const mates = (team === "A" ? A : B).filter((p) => p.id !== id).map((p) => scoreBefore.get(p.id)!);
      const others = (team === "A" ? B : A).map((p) => scoreBefore.get(p.id)!);
      expect(Number(partner), `${id} partner`).toBeCloseTo(mean(mates), 1);
      expect(Number(opp), `${id} opponent`).toBeCloseTo(mean(others), 1);
    }
  });
  it("records the outcome and what was expected: the weaker team winning is above expectation", () => {
    const out = sql(`${game("A")} select team || '|' || outcome || '|' || expected || '|' || result_signal from public.player_game_stats where run_id = '${RUN}' and user_id in ('${A[0]!.id}', '${B[0]!.id}') order by team;`).filter((l) => l.includes("|"));
    const [a, b] = out.map((l) => l.split("|"));
    expect(a![1]).toBe("W");
    expect(b![1]).toBe("L");
    expect(Number(a![2])).toBeLessThan(0.5); // A averages 56, B averages 60
    expect(Number(a![3])).toBeGreaterThan(0.5);
    expect(Number(b![3])).toBeLessThan(-0.5);
  });
  it("a draw is D for both teams", () => {
    const out = sql(`${game("draw")} select distinct outcome from public.player_game_stats where run_id = '${RUN}';`).filter((l) => !l.startsWith("1") && l.length === 1);
    expect(out).toEqual(["D"]);
  });
  it("the profile view shows record, partner and opponent stars, and keeps raw scores out", () => {
    const out = sql(`${game()} select wins || '|' || draws || '|' || losses || '|' || partner_stars || '|' || opponent_stars || '|' || partner_games from public.player_card_stats where user_id = '${A[0]!.id}';`).filter((l) => l.includes("|"));
    const [w, d, l, ps, os, pg] = out[0]!.split("|");
    expect([w, d, l]).toEqual(["1", "0", "0"]);
    expect(Number(ps) * 2).toBe(Math.round(Number(ps) * 2)); // half stars
    expect(Number(os) * 2).toBe(Math.round(Number(os) * 2));
    expect(Number(pg)).toBe(1);
    const cols = sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'player_card_stats';");
    expect(cols[0]).not.toMatch(/(^|,)(score|partner_avg|opponent_avg|reliab|tier)/);
  });
  it("performance counts verified results only, then moves when the result is confirmed", () => {
    const q = `select coalesce(perf_games::text, 'null') || '|' || coalesce(perf_vs_expected::text, 'null') from public.player_card_stats where user_id = '${A[0]!.id}';`;
    const out = sql(`${game()} ${q} ${confirmBoth} ${q}`).filter((l) => l.includes("|"));
    expect(out[0]).toBe("0|null");
    expect(out[1]!.startsWith("1|")).toBe(true);
    expect(Number(out[1]!.split("|")[1])).toBeGreaterThan(0.5);
  });
  it("can include unverified results when asked, for display only", () => {
    const q = `select perf_games from public.player_card_stats where user_id = '${A[0]!.id}';`;
    const out = sql(`${game()} update public.rating_config set value = 1 where key = 'profile_include_unverified'; ${q}`).filter((l) => /^\d+$/.test(l));
    expect(out.at(-1)).toBe("1");
  });
  it("editing the result updates the stats, and verified goes back to false", () => {
    const out = sql(`${game()} ${confirmBoth}
      update public.pickup_run_results set winning_team = 'B' where run_id = '${RUN}';
      select outcome || '|' || verified from public.player_game_stats where run_id = '${RUN}' and user_id = '${A[0]!.id}';`).filter((l) => l.includes("|"));
    expect(out.at(-1)).toBe("L|false");
  });
  it("missing history is handled: no settled game, no result, or a player with no events", () => {
    // result posted but the game never settled: no rows, no error
    const none = sql(`${game().replace(/select public\.settle_session\('[^']+'\);/, "")} select count(*) from public.player_game_stats;`);
    expect(none.at(-1)).toBe("0");
    // settled but no result: partner and opponent averages are there, outcome is not
    const noResult = sql(`${game().replace(/insert into public\.pickup_run_results[^;]*;/, "")} select count(*) || '|' || count(outcome) || '|' || count(partner_avg) from public.player_game_stats;`).filter((l) => l.includes("|"));
    expect(noResult[0]).toBe("10|0|10");
    // a one-player team has no partner average
    const solo = sql(`${game().replace(/select public\.settle_session[^;]*;/, `update public.pickup_run_team_assignments set team = 'A' where run_id = '${RUN}' and team = 'B' and user_id <> '${B[0]!.id}'; select public.settle_session('${TS}');`)} select count(*) from public.player_game_stats where partner_avg is null;`);
    expect(Number(solo.at(-1))).toBeGreaterThanOrEqual(1);
  });
  it("backfill rebuilds the table for games settled earlier", () => {
    const out = sql(`${game()} delete from public.player_game_stats; select public.backfill_player_game_stats(); select count(*) from public.player_game_stats;`);
    expect(out.at(-1)).toBe("10");
  });
  it("raw stats are server only; the public view is readable by players", () => {
    expect(sqlError(`${game()} set local role authenticated; select * from public.player_game_stats;`)).toMatch(/permission denied/);
    expect(sqlError(`${game()} set local role authenticated; select * from public.player_card_stats;`)).toBeNull();
  });
});
