import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CASES, block, run, type Spec } from "./equivalenceHelpers";
import { SQL_TESTS_ENABLED, sql } from "./harness";
import { captain, find, match, players, ratingMap, ratingsOf, sync, sync_json, world, type W } from "./tournamentWorld";

/**
 * Rated tournament matches between teams of different sizes (migration 20261108000000_tournament_uneven_teams.sql).
 * A tournament match may now differ by up to rating_config 'tournament_max_team_diff' (8) players; every other game keeps
 * result_max_team_diff (1) exactly as before. Everything else (8 players minimum in the match, per game cap 2, daily cap 3) is unchanged.
 */

const migrationPath = new URL("../../supabase/migrations/20261108000000_tournament_uneven_teams.sql", import.meta.url);
const MIG = readFileSync(migrationPath, "utf8");
const previousApply = block("20261106000000_rated_tournaments.sql", "apply_result_rating").replace("public.apply_result_rating(", "public.apply_result_rating_deployed(");

const one = (sizes: number[], sa = 2, sb = 0): W => ({ sizes, matches: [{ n: 1, sa, sb, winner: sa > sb ? 0 : sa < sb ? 1 : null }] });
const result = (w: W) => {
  const out = sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}`);
  return { j: sync_json(out, 1), r: ratingMap(out) };
};

describe.skipIf(!SQL_TESTS_ENABLED)("uneven teams in rated tournaments (real Postgres)", () => {
  it("1. 5 v 7 counts in a rated tournament, for all twelve players", () => {
    const w = one([5, 7]);
    const { j, r } = result(w);
    expect(j).toMatchObject({ counted: true, reason: null, players: 12 });
    expect(r.get(captain(0))!.score).toBe(51.2);
    expect(r.get(captain(1))!.score).toBe(48.8);
    expect(players(w).filter((p) => r.get(p)!.score === 50)).toEqual([]);
  });

  it("2. 6 v 9 counts; 5 v 13 is the widest that counts; 5 v 14 does not, and says why", () => {
    expect(result(one([6, 9])).j.counted).toBe(true);
    expect(result(one([5, 13])).j).toMatchObject({ counted: true, reason: null });
    const big = result(one([5, 14]));
    expect(big.j).toMatchObject({ counted: false, reason: "teams_uneven" });
    expect([...big.r.values()].every((v) => v.score === 50)).toBe(true);
    const flipped = result(one([14, 5]));
    expect(flipped.j).toMatchObject({ counted: false, reason: "teams_uneven" });
  });

  it("3. an ordinary game keeps the old rule: 5 v 7 counts for nothing, 5 v 6 still counts", () => {
    const wide: Spec = { scores: Array(12).fill(50), teamB: 7 };
    const r = run(wide);
    expect(r.moved).toEqual(["0", "0"]);
    const close: Spec = { scores: Array(11).fill(50), teamB: 6 };
    expect(run(close).moved).toEqual(["11", "11"]);
  });

  it("4. the two limits are independent: loosening one never moves the other", () => {
    // tournament 5 v 7 still counts when the ordinary limit is 0, and an ordinary game still fails when the tournament limit is 20
    const out = sql(`${world(one([5, 7]))} update public.rating_config set value = 0 where key = 'result_max_team_diff'; ${sync(1)}`);
    expect(sync_json(out, 1).counted).toBe(true);
    const ord = sql(`update public.rating_config set value = 20 where key = 'tournament_max_team_diff'; select 'ok';`);
    expect(ord).toEqual(["ok"]);
    const wide = run({ scores: Array(12).fill(50), teamB: 7 });
    expect(wide.moved).toEqual(["0", "0"]);
    // and the tournament limit is read from the row, nothing else
    for (const [limit, sizes, counted] of [[2, [5, 7], true], [2, [5, 8], false], [0, [5, 6], false], [0, [5, 5], true]] as const) {
      const o = sql(`${world(one([...sizes]))} update public.rating_config set value = ${limit} where key = 'tournament_max_team_diff'; ${sync(1)}`);
      expect([limit, sizes, sync_json(o, 1).counted]).toEqual([limit, sizes, counted]);
    }
  });

  it("4b. if the tournament row were deleted, tournaments fall back to the ordinary limit (never to no limit)", () => {
    const gone = (sizes: number[]) => sync_json(sql(`${world(one(sizes))} delete from public.rating_config where key = 'tournament_max_team_diff'; ${sync(1)}`), 1);
    expect(gone([5, 7]).counted).toBe(false);
    expect(gone([5, 7]).reason).toBe("teams_uneven");
    expect(gone([5, 6]).counted).toBe(true);
  });

  it("5. the other rules are unchanged: 8 players in the match are still needed, a missing team still fails", () => {
    expect(result(one([3, 3])).j).toMatchObject({ counted: false, reason: "too_few_players" });
    expect(result(one([4, 4])).j.counted).toBe(true);
    expect(result(one([2, 5])).j).toMatchObject({ counted: false, reason: "too_few_players" });
    // KNOWN: the only size floor is the 8 players in total, so 1 v 7 counts. See the PR notes.
    expect(result(one([1, 7])).j.counted).toBe(true);
  });

  it("6. editing a score on an uneven match never stacks", () => {
    const w = one([5, 8]);
    const once = ratingMap(sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}`));
    const thrice = ratingMap(sql(`${world(w)} ${sync(1)} ${sync(1)} ${sync(1)} ${ratingsOf(players(w))}`));
    expect([...thrice.entries()]).toEqual([...once.entries()]);
    const edited = ratingMap(sql(`${world(w)} ${sync(1)} update public.tournament_matches set score_a = 0, score_b = 3, winner_id = '${"00000000-0000-4000-8000-" + String(5200 + 1).padStart(12, "0")}' where id = '${match(1)}'; ${sync(1)} ${sync(1)} ${ratingsOf(players(w))}`));
    const direct = ratingMap(sql(`${world(one([5, 8], 0, 3))} ${sync(1)} ${ratingsOf(players(w))}`));
    expect([...edited.entries()]).toEqual([...direct.entries()]);
    // and clearing the score takes it all back out
    const cleared = ratingMap(sql(`${world(w)} ${sync(1)} update public.tournament_matches set score_a = null, score_b = null, winner_id = null, completed_at = null where id = '${match(1)}'; ${sync(1)} ${ratingsOf(players(w))}`));
    expect([...cleared.values()].every((v) => v.score === 50)).toBe(true);
  });

  it("7. the daily cap still holds for uneven matches: five wins in one day move a player by 3, not 6", () => {
    const w: W = { sizes: [5, 8], matches: [1, 2, 3, 4, 5].map((n) => ({ n, sa: 2, sb: 0, winner: 0, at: `2026-11-14 1${n}:00` })) };
    const out = sql(`${world(w)} ${[1, 2, 3, 4, 5].map(sync).join("\n")} ${ratingsOf(players(w))}`);
    const r = ratingMap(out);
    expect(r.get(captain(0))!.score).toBe(53);
    expect(r.get(captain(1))!.score).toBe(47);
    for (const p of players(w)) expect(Math.abs(r.get(p)!.score - 50)).toBeLessThanOrEqual(3);
  });

  it("8. the per game cap still holds: a huge upset by the smaller team moves nobody more than 2", () => {
    const w = one([5, 8], 2, 0);
    const a = players(w).slice(0, 5);
    const b = players(w).slice(5);
    const out = sql(`${world(w)} update public.player_ratings set score = 10 where user_id in (${a.map((p) => `'${p}'`).join(",")}); update public.player_ratings set score = 90 where user_id in (${b.map((p) => `'${p}'`).join(",")}); ${sync(1)} ${ratingsOf(players(w))}`);
    const r = ratingMap(out);
    for (const p of a) expect(r.get(p)!.score).toBe(12);
    for (const p of b) expect(r.get(p)!.score).toBe(88);
  });

  it("9. fairness: the size of a team changes neither the expectation nor the points per player, only how many players share them", () => {
    const eq = (sizes: number[]) => {
      const out = sql(`${world(one(sizes))} ${sync(1)} select 'adj|' || a.delta || '|' || a.result_signal || '|' || a.expected from public.rating_result_adjustments a where a.user_id = '${captain(0)}';`);
      return find(out, "adj|");
    };
    // equal ratings: expectation is 0.5 whatever the sizes, a win is +1.2 for every player of the winning team
    expect(eq([5, 5])).toBe("adj|1.20|0.5000|0.5000");
    expect(eq([5, 8])).toBe("adj|1.20|0.5000|0.5000");
    expect(eq([5, 13])).toBe("adj|1.20|0.5000|0.5000");
    // so the points a match creates or destroys are not balanced: 8 winners at +1.2 against 5 losers at -1.2
    const w = one([8, 5]);
    const r = ratingMap(sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}`));
    const total = [...r.values()].reduce((s, v) => s + (v.score - 50), 0);
    expect(Math.round(total * 100) / 100).toBe(3.6);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("ordinary games: the new function equals the one deployed today (the 20261106000000 version)", () => {
  for (const [name, spec] of CASES) {
    it(name, () => {
      const r = run(spec, previousApply);
      expect(r.first[1]).toEqual(r.first[0]);
      expect(r.moved[1]).toBe(r.moved[0]);
      expect(r.edited[1]).toEqual(r.edited[0]);
    });
  }
  for (const [name, spec] of [
    ["5 v 7 (uneven by 2)", { scores: Array(12).fill(50), teamB: 7 }],
    ["5 v 13 (uneven by 8)", { scores: Array(18).fill(50), teamB: 13 }],
    ["4 v 4 with unequal ratings", { scores: [...Array(4).fill(65), ...Array(4).fill(40)], sessions: 2 }],
    ["6 v 5 with an upset", { scores: [...Array(6).fill(30), ...Array(5).fill(70)], teamB: 5, winner: "A" }],
  ] as Array<[string, Spec]>) {
    it(`ordinary ${name} is identical before and after`, () => {
      const r = run(spec, previousApply);
      expect(r.first[1]).toEqual(r.first[0]);
      expect(r.moved[1]).toBe(r.moved[0]);
    });
  }
});

describe.skipIf(!SQL_TESTS_ENABLED)("the rollback and the migration file (real Postgres)", () => {
  const lines = MIG.split("\n");
  const rb = lines.slice(lines.indexOf("-- >>> ROLLBACK BEGIN") + 1, lines.indexOf("-- <<< ROLLBACK END"))
    .map((l) => l.replace(/^--\s?/, ""))
    .filter((l) => !/^(begin|commit);$/.test(l.trim()))
    .join("\n");
  const body = MIG.slice(MIG.indexOf("\nbegin;\n")).replace(/^\s*(begin|commit);$/gm, "");
  const prosrc = "select md5(prosrc) from pg_proc where proname = 'apply_result_rating' and pronamespace = 'public'::regnamespace";

  it("the rollback block restores the exact previous function and removes the config row", () => {
    const out = sql(`${previousApply}
      select 'prev|' || md5(prosrc) from pg_proc where proname = 'apply_result_rating_deployed';
      select 'new|' || (${prosrc});
      ${rb}
      select 'restored|' || (${prosrc});
      select 'row|' || count(*) from public.rating_config where key = 'tournament_max_team_diff';
      select 'limit|' || value from public.rating_config where key = 'result_max_team_diff';`);
    expect(find(out, "new|")).not.toBe(find(out, "prev|")!.replace("prev|", "new|"));
    expect(find(out, "restored|")!.replace("restored|", "")).toBe(find(out, "prev|")!.replace("prev|", ""));
    expect(find(out, "row|")).toBe("row|0");
    expect(find(out, "limit|")).toBe("limit|1");
  });

  it("after the rollback a tournament 5 v 7 is uneven again", () => {
    const out = sql(`${world(one([5, 7]))} ${rb} ${sync(1)}`);
    expect(sync_json(out, 1)).toMatchObject({ counted: false, reason: "teams_uneven" });
  });

  it("running the migration again, or rolling back and re-applying, is harmless", () => {
    const out = sql(`${body} ${body} ${rb} ${body} select 'row|' || value from public.rating_config where key = 'tournament_max_team_diff'; select 'src|' || (${prosrc});`);
    expect(find(out, "row|")).toBe("row|8");
    const again = sql(`select 'src|' || (${prosrc});`);
    expect(find(out, "src|")).toBe(find(again, "src|"));
  });

  it("an existing config value is never overwritten", () => {
    const out = sql(`update public.rating_config set value = 3 where key = 'tournament_max_team_diff'; ${body} select 'row|' || value from public.rating_config where key = 'tournament_max_team_diff';`);
    expect(find(out, "row|")).toBe("row|3");
  });

  it("the read only check queries in the header run and say what they should", () => {
    const out = sql(`select 'md5|' || (${prosrc}); select 'has|' || (prosrc like '%tournament_max_team_diff%') from pg_proc where proname = 'apply_result_rating'; select 'cfg|' || key || '=' || value from public.rating_config where key in ('tournament_max_team_diff', 'result_max_team_diff') order by key;`);
    expect(find(out, "md5|")).toMatch(/^md5\|[0-9a-f]{32}$/);
    expect(find(out, "has|")).toMatch(/^has\|(t|true)$/);
    expect(out.filter((l) => l.startsWith("cfg|"))).toEqual(["cfg|result_max_team_diff=1", "cfg|tournament_max_team_diff=8"]);
  });
});

describe("the migration file (text)", () => {
  it("has the rollback at the top, guarded, additive, and changes only the tournament branch", () => {
    const head = MIG.slice(0, MIG.indexOf("\nbegin;\n"));
    expect(head).toContain("ROLLBACK");
    expect(head).toContain("to_regclass('public.tournament_match_rating')");
    expect(head).toContain("to_regclass('public.rating_config')");
    expect(head).toContain("select md5(prosrc) from pg_proc");
    expect(MIG).toContain("on conflict (key) do nothing");
    expect(MIG).toMatch(/\('tournament_max_team_diff', 8,/);
    expect(MIG.toLowerCase()).not.toMatch(/drop table|truncate|delete from public\.(?!rating_config)/);
    expect(MIG.includes("—")).toBe(false);
    // the ordinary limit is still the one read for every game that is not a tournament match
    expect(MIG).toContain("else (cfg ->> 'result_max_team_diff')::numeric end");
    expect(MIG).toContain("'teams_uneven'");
  });

  it("the new function differs from the previous one only in the team size condition", () => {
    const prev = block("20261106000000_rated_tournaments.sql", "apply_result_rating");
    const next = (() => {
      const from = MIG.indexOf("\ncreate or replace function public.apply_result_rating(") + 1;
      return MIG.slice(from, MIG.indexOf("\n$body$;", from) + 8);
    })();
    const pl = prev.split("\n");
    const nl = next.split("\n");
    const removed = pl.filter((l) => !nl.includes(l));
    const added = nl.filter((l) => !pl.includes(l));
    expect(removed).toEqual(["           and abs(n_a - n_b) <= (cfg ->> 'result_max_team_diff')::numeric;"]);
    expect(added.join("\n")).toContain("tournament_max_team_diff");
    expect(added.length).toBe(5);
  });
});
