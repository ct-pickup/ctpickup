import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seed = readFileSync(new URL("../../scripts/test-tournament/seed.sql", import.meta.url), "utf8");
const cleanup = readFileSync(new URL("../../scripts/test-tournament/cleanup.sql", import.meta.url), "utf8");
const code = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("scripts/test-tournament/seed.sql", () => {
  const c = code(seed);

  it("is one transaction that prints a short result", () => {
    expect(c).toMatch(/^begin;$/m);
    expect(c).toMatch(/^commit;$/m);
    expect(c.indexOf("begin;")).toBeLessThan(c.indexOf("commit;"));
    expect(c).toMatch(/raise notice 'Seeded tournament/);
    expect(c).toMatch(/select t\.id as tournament_id/);
  });

  it("takes exactly 40 placeholder ids at the top and refuses to run with them", () => {
    const rows = [...c.matchAll(/^\s+\((\d+), '(00000000-0000-0000-0000-\d{12})'\)[,;]$/gm)];
    expect(rows).toHaveLength(40);
    expect(rows.map((r) => Number(r[1]))).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(c).toMatch(/like '00000000-0000-0000-0000-0000000000%'/);
    expect(c).toMatch(/not in public\.profiles/);
    // The query for picking real ids returns ids only.
    expect(seed).toMatch(/select string_agg\(format\('  \(%s, %L\)', n, id\)/);
    expect(seed).not.toMatch(/first_name|last_name|email|username/i);
  });

  it("creates the labeled tournament with the flags off and starting tomorrow", () => {
    expect(c).toMatch(/c_slug\s+constant text := 'test-bracket-demo'/);
    expect(c).toMatch(/c_title\s+constant text := 'TEST Bracket Demo \(delete me\)'/);
    expect(c).toMatch(/interval '1 day 14 hours'/);
    expect(c).toMatch(/set rated = false, count_for_season = false/);
  });

  it("only takes the live slot when no other tournament holds it", () => {
    expect(c).toMatch(/v_active := not exists \(select 1 from public\.tournaments where is_active = true and service_region is not distinct from c_region\)/);
  });

  it("uses the status strings the app uses, and the shapes the app writes", () => {
    expect(c).toMatch(/'confirmed', true, 'Test Captain ' \|\| i/);
    expect(c).toMatch(/'Test Team ' \|\| i/);
    expect(c).toMatch(/'accepted', now\(\), now\(\)/);
    expect(c).toMatch(/'group', v_group, v_match/);
    expect(c).toMatch(/\(group_id, tournament_id, team_id, wins, draws, losses, goals_for, goals_against, goal_difference, points\)/);
  });

  it("makes 8 teams, 4 roster players each (5 with the captain), 2 groups of 4 and 12 unscored matches", () => {
    expect(c).toMatch(/for i in 1\.\.8 loop/);
    expect(c).toMatch(/for k in 1\.\.4 loop/);
    expect(c).toMatch(/u\.n = 8 \+ \(i - 1\) \* 4 \+ k/);
    expect(c).toMatch(/for g in 0\.\.1 loop/);
    expect(c).toMatch(/for j in \(i \+ 1\)\.\.4 loop/);
    expect(c).not.toMatch(/score_a|score_b|winner_id|completed_at|started_at/);
  });

  it("is safe to run twice and fails cleanly when the tables are missing", () => {
    expect(c).toMatch(/if exists \(select 1 from public\.tournaments where slug = c_slug\) then/);
    expect(c).toMatch(/Nothing changed/);
    expect(c).toMatch(/to_regclass\('public\.' \|\| t\) is null/);
    expect(c).toMatch(/raise exception 'Table public\.% does not exist/);
  });

  it("contains no personal data", () => {
    expect(seed).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(seed).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
    expect(c).toMatch(/'test-captain-' \|\| i/);
  });
});

describe("scripts/test-tournament/cleanup.sql", () => {
  const c = code(cleanup);

  it("is one transaction keyed on the slug and the title together", () => {
    expect(c).toMatch(/^begin;$/m);
    expect(c).toMatch(/^commit;$/m);
    expect(c).toMatch(/where slug = c_slug and title = c_title/);
    expect(c).toMatch(/Refusing to delete it/);
  });

  it("deletes children before parents", () => {
    const deleteBlock = cleanup.slice(cleanup.indexOf("-- Children first"), cleanup.indexOf("-- Verify"));
    const order = ["tournament_match_goals", "tournament_mvp_votes", "tournament_match_runs", "tournament_matches", "tournament_group_members", "tournament_groups", "tournament_join_requests", "tournament_roster_prelim", "tournament_roster", "tournament_captains", "'tournaments'"];
    const at = order.map((t) => deleteBlock.indexOf(t.startsWith("'") ? t : `'${t}'`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("skips tables that do not exist and never deletes payment records", () => {
    expect(c).toMatch(/to_regclass\('public\.' \|\| r\.tbl\) is null/);
    expect(c).not.toMatch(/delete from public\.tournament_payments/);
    expect(c).toMatch(/payment record\(s\)\. Refund them first/);
  });

  it("verifies with counts, rolls back if anything remains, and prints a result", () => {
    expect(c).toMatch(/select count\(\*\) from public\.%I where %s/);
    expect(c).toMatch(/Cleanup is incomplete/);
    expect(c).toMatch(/Cleanup verified: 0 rows remain/);
    expect(c).toMatch(/select \(select count\(\*\) from public\.tournaments where slug = 'test-bracket-demo'\) as tournaments_left/);
  });

  it("is safe to run twice", () => {
    expect(c).toMatch(/Nothing to clean up: no tournament with slug/);
  });
});
