import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql } from "./harness";
import { TOUR, captain, find, match, ordinaryGame, players, rating, ratingMap, sync, world, type W } from "./tournamentWorld";

/**
 * The rollback file, proven: after a rated tournament has moved ratings, running scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql
 * puts every rating back, removes every record, policy, function and table the migration added, and restores the two replaced functions to
 * the exact text of the earlier migrations. Then the migration can be applied again. The files carry their own begin and commit; the tests
 * strip those so the harness can roll everything back at the end.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/^begin;$/gm, "").replace(/^commit;$/gm, "");
const rollback = strip(read("scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql"));
const migration = strip(read("supabase/migrations/20261106000000_rated_tournaments.sql"));

function body(file: string, name: string): string {
  const s = read(`supabase/migrations/${file}`);
  const starts = [...s.matchAll(new RegExp(`create or replace function public\\.${name}\\(`, "g"))].map((m) => m.index!);
  const i = starts[starts.length - 1]!;
  const a = s.indexOf("as $body$", i) + "as $body$".length;
  return s.slice(a, s.indexOf("$body$;", a));
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const APPLY_MD5 = md5(body("20261101000300_rating_v2_expectations.sql", "apply_result_rating"));
const REFRESH_MD5 = md5(body("20261101000200_player_game_stats.sql", "refresh_player_game_stats"));

const scored: W = { matches: [{ n: 1, sa: 3, sb: 1 }, { n: 2, sa: 2, sb: 0, at: "2026-11-15 12:00" }], season: true };

describe("the rollback file is made from the deployed functions, not from memory", () => {
  it("embeds the exact deployed text of both functions", () => {
    const file = read("scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql");
    expect(file).toContain(body("20261101000300_rating_v2_expectations.sql", "apply_result_rating"));
    expect(file).toContain(body("20261101000200_player_game_stats.sql", "refresh_player_game_stats"));
    expect(body("20261101000300_rating_v2_expectations.sql", "apply_result_rating")).not.toMatch(/TOURNAMENT/);
  });

  it("is one transaction, drops only what the migration created, and never touches tables it did not create", () => {
    const file = read("scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql");
    expect(file).toMatch(/^begin;$/m);
    expect(file).toMatch(/^commit;$/m);
    const dropped = [...file.matchAll(/drop (?:function|table) if exists public\.(\w+)/g)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(["is_tournament_run", "tournament_day_session", "tournament_daily_max_delta", "tournament_forget_matches", "tournament_match_rating", "tournament_rating_days", "tournament_reapply_day", "tournament_revert_run", "tournament_run_counts_for_season", "tournament_sync_match", "tournament_sync_tournament", "tournament_unrate_tournament"].sort());
    expect(file).not.toMatch(/drop table if exists public\.(tournaments|tournament_match_runs|pickup_runs|player_ratings)/);
    expect(file).not.toMatch(/\btruncate\b/i);
  });

  it("every object the migration creates is removed by the rollback", () => {
    const mig = read("supabase/migrations/20261106000000_rated_tournaments.sql");
    const created = [...mig.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]!).filter((n) => !["apply_result_rating", "refresh_player_game_stats"].includes(n));
    const file = read("scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql");
    for (const f of created) expect(file, f).toMatch(new RegExp(`drop function if exists public\\.${f}\\(`));
    for (const t of ["tournament_rating_days", "tournament_match_rating"]) expect(file).toMatch(new RegExp(`drop table if exists public\\.${t}`));
    expect(file).toMatch(/delete from public\.rating_config where key = 'tournament_daily_max_delta'/);
    for (const t of ["pickup_runs", "pickup_run_results", "pickup_run_rsvps", "pickup_run_team_assignments"]) expect(file).toMatch(new RegExp(`drop policy if exists tournament_match_runs_hidden on public\\.${t}`));
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("rolling back (real Postgres)", () => {
  const state = `
    select 'policies|' || count(*) from pg_policy where polname = 'tournament_match_runs_hidden';
    select 'fn|' || count(*) from pg_proc where proname in ('tournament_sync_match','tournament_sync_tournament','tournament_forget_matches','tournament_unrate_tournament','tournament_revert_run','tournament_reapply_day','tournament_day_session','tournament_run_counts_for_season','is_tournament_run','tournament_daily_max_delta');
    select 'tables|' || (to_regclass('public.tournament_rating_days') is not null)::int || (to_regclass('public.tournament_match_rating') is not null)::int;
    select 'cfg|' || count(*) from public.rating_config where key = 'tournament_daily_max_delta';
    select 'apply-md5|' || md5(prosrc) from pg_proc where proname = 'apply_result_rating';
    select 'refresh-md5|' || md5(prosrc) from pg_proc where proname = 'refresh_player_game_stats';
    select 'hidden|' || (select count(*) from public.pickup_runs where title = 'Tournament match') || '|' || (select count(*) from public.tier_sessions where venue = 'Tournament day');`;

  it("the two one-query checks in docs/rated-tournaments-rollout.md say true after the migration and after the rollback, and the md5s in it are right", () => {
    const doc = read("docs/rated-tournaments-rollout.md");
    const queries = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const after = queries.find((q) => q.includes("as ok;"))!.trim().replace(/;$/, "");
    const back = queries.find((q) => q.includes("as rolled_back;"))!.trim().replace(/;$/, "");
    expect(doc).toContain(APPLY_MD5);
    expect(doc).toContain(REFRESH_MD5);
    const migrated = sql(`select 'ok|' || (${after});`);
    expect(find(migrated, "ok|")).toBe("ok|true");
    const rolled = sql(`${world({ matches: [] })} ${rollback} select 'back|' || (${back}); select 'ok|' || (${after});`);
    expect(find(rolled, "back|")).toBe("back|true");
    expect(find(rolled, "ok|")).toBe("ok|false");
  });

  it("the migration as written is NOT the deployed text (so the md5 check below can tell the difference)", () => {
    const out = sql(`${state}`);
    expect(find(out, "apply-md5|")).not.toBe(`apply-md5|${APPLY_MD5}`);
    expect(find(out, "refresh-md5|")).not.toBe(`refresh-md5|${REFRESH_MD5}`);
    expect(find(out, "policies|")).toBe("policies|4");
  });

  it("puts every rating back, removes everything, restores the two functions byte for byte, and can be run twice", () => {
    const out = sql(`${world(scored)} ${sync(1)} ${sync(2)}
      select 'moved|' || count(*) from public.player_ratings where score <> 50;
      update public.tournaments set rated = true;
      ${rollback}
      ${rollback}
      select 'moved-after|' || count(*) from public.player_ratings where score <> 50;
      ${state}`);
    expect(find(out, "moved|")).toBe("moved|10"); // the same 10 players played both matches
    expect(find(out, "moved-after|")).toBe("moved-after|0");
    expect(find(out, "policies|")).toBe("policies|0");
    expect(find(out, "fn|")).toBe("fn|0");
    expect(find(out, "tables|")).toBe("tables|00");
    expect(find(out, "cfg|")).toBe("cfg|0");
    expect(find(out, "hidden|")).toBe("hidden|0|0");
    expect(find(out, "apply-md5|")).toBe(`apply-md5|${APPLY_MD5}`);
    expect(find(out, "refresh-md5|")).toBe(`refresh-md5|${REFRESH_MD5}`);
  });

  it("an ordinary game still rates normally after the rollback", () => {
    const out = sql(`${world({ matches: [] })} ${ordinaryGame()} ${rollback}
      select 'moved|' || public.apply_result_rating('${"00000000-0000-4000-8000-000000008200"}');
      ${rating(captain(0))}`);
    expect(find(out, "moved|")).toBe("moved|10");
    expect(ratingMap(out).get(captain(0))!.score).toBe(51.2);
  });

  it("the migration can be applied again after a rollback, and rated tournaments work again", () => {
    const out = sql(`${world(scored)} ${rollback} ${migration}
      ${sync(1)}
      select 'moved|' || count(*) from public.player_ratings where score <> 50;
      select 'policies|' || count(*) from pg_policy where polname = 'tournament_match_runs_hidden';
      ${rating(captain(0))}`);
    expect(find(out, "moved|")).toBe("moved|10");
    expect(find(out, "policies|")).toBe("policies|4");
    expect(ratingMap(out).get(captain(0))!.score).toBe(51.2);
  });

  it("a rollback on a database where the migration was never applied does no harm", () => {
    // simulate by rolling back twice inside one run after a first rollback: nothing left to take out, the functions are the deployed ones
    const out = sql(`${world({ matches: [] })} ${rollback} ${rollback} ${state}`);
    expect(find(out, "apply-md5|")).toBe(`apply-md5|${APPLY_MD5}`);
  });
});

void [TOUR, match, players];
