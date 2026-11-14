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

  it("needs only 4 user ids, as placeholders at the top, and refuses to run with them", () => {
    const rows = [...c.matchAll(/^\s+\((\d+), '(00000000-0000-0000-0000-\d{12})'\)[,;]$/gm)];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => Number(r[1]))).toEqual([1, 2, 3, 4]);
    expect(c).toMatch(/like '00000000-0000-0000-0000-0000000000%'/);
    expect(c).toMatch(/not in public\.profiles/);
    expect(c).toMatch(/Paste 4 real profiles\.id values/);
  });

  it("only ever asks for ids of staff or friends who agreed, found by name in a private editor, never picked at random", () => {
    expect(seed).toMatch(/staff or friends who agreed to be test accounts, never random players/);
    expect(seed).not.toMatch(/order by random\(\)/i);
    expect(seed).not.toMatch(/approved = true/i);
    // The lookup is by name, with placeholders for the names, and it says the result stays private.
    expect(seed).toMatch(/lower\(trim\(p\.first_name\)\) = lower\(trim\(w\.first_name\)\)/);
    expect(seed).toMatch(/lower\(trim\(p\.last_name\)\)\s+= lower\(trim\(w\.last_name\)\)/);
    for (const n of [1, 2, 3, 4]) expect(seed).toContain(`'FIRST NAME ${n}', 'LAST NAME ${n}'`);
    expect(seed).toMatch(/PRIVATE SQL Editor tab/);
    expect(seed).toMatch(/The result contains names\. Keep it in your private editor/);
    expect(seed).toMatch(/do not save it, screenshot it, share it, or paste names into this file/);
    expect(seed).toMatch(/format\('  \(%s, %L\)', w\.n, p\.id\) as paste_row/);
  });

  it("creates the labeled tournament INACTIVE, starting tomorrow, with the flags off and min roster 1", () => {
    expect(c).toMatch(/c_slug\s+constant text := 'test-bracket-demo'/);
    expect(c).toMatch(/c_title\s+constant text := 'TEST Bracket Demo \(delete me\)'/);
    expect(c).toMatch(/\(c_title, c_slug, false, c_region, 4, 4, 4, v_start,/);
    expect(c).not.toMatch(/is_active = true|v_active/);
    expect(c).toMatch(/'TEST DATA: 4 teams, 2 groups of 2, then knockout\.', 0, 1,/);
    expect(c).toMatch(/interval '1 day 14 hours'/);
    expect(c).toMatch(/set rated = false, count_for_season = false/);
    expect(c).toMatch(/exception when check_violation then/);
  });

  it("explains how to switch it on safely and where an admin finds it while it is off", () => {
    expect(seed).toMatch(/It is created with is_active FALSE/);
    expect(seed).toMatch(/Admin > Tournaments > the "Upcoming" tab/);
    expect(seed).toMatch(/update public\.tournaments set is_active = true/);
    expect(seed).toMatch(/not exists \(select 1 from public\.tournaments t2 where t2\.is_active and t2\.service_region is null\)/);
    expect(seed).toMatch(/update public\.tournaments set is_active = false where slug = 'test-bracket-demo'/);
  });

  it("says no push is ever sent for it", () => {
    expect(seed).toMatch(/NO NOTIFICATIONS: the server never sends a push for a tournament whose slug starts with "test-"/);
  });

  it("uses the status strings the app uses, and the shapes the app writes", () => {
    expect(c).toMatch(/'confirmed', true, 'Test Captain ' \|\| i/);
    expect(c).toMatch(/'Test Team ' \|\| i/);
    expect(c).toMatch(/'group', v_group, v_match/);
    expect(c).toMatch(/\(group_id, tournament_id, team_id, wins, draws, losses, goals_for, goals_against, goal_difference, points\)/);
  });

  it("makes 4 captain-only teams (no roster rows), 2 groups of 2 and 2 unscored matches", () => {
    expect(c).toMatch(/for i in 1\.\.4 loop/);
    expect(c).not.toMatch(/tournament_roster/);
    expect(c).toMatch(/1, 1, now\(\), now\(\)/);
    expect(c).toMatch(/for g in 0\.\.1 loop/);
    expect(c).toMatch(/v_base := g \* 2;/);
    expect(c).toMatch(/for i in 1\.\.2 loop/);
    expect(c).toMatch(/v_caps\[v_base \+ 1\], v_caps\[v_base \+ 2\]/);
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
    // The only names in the file are the FIRST NAME n / LAST NAME n placeholders.
    expect(seed.match(/first_name|last_name/g)?.length).toBeGreaterThan(0);
    expect(seed).not.toMatch(/'(?!FIRST NAME|LAST NAME)[A-Z][a-z]+', '[A-Z][a-z]+'/);
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

describe("scripts/test-tournament/rated-demo.sql", () => {
  const rated = readFileSync(new URL("../../scripts/test-tournament/rated-demo.sql", import.meta.url), "utf8");
  const c = code(rated);

  it("is one transaction that only touches the test tournament, found by slug and title together", () => {
    expect(c).toMatch(/^begin;$/m);
    expect(c).toMatch(/^commit;$/m);
    expect(c).toMatch(/where slug = c_slug and title = c_title/);
    expect(c).toMatch(/c_slug  constant text := 'test-bracket-demo'/);
    for (const m of c.matchAll(/\b(update|delete from|insert into) public\.(\w+)/g)) expect(["tournament_roster", "tournaments"]).toContain(m[2]);
    expect(c.replace(/\(delete me\)/g, "")).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop (table|column|function|policy)\b/i);
  });

  it("refuses placeholders, unknown profiles, existing captains, a scored match and a database without the migrations", () => {
    expect(c).toMatch(/still the placeholders/);
    expect(c).toMatch(/are not in public\.profiles/);
    expect(c).toMatch(/already a captain of the test tournament/);
    expect(c).toMatch(/already has a score, so Rated can no longer be changed/);
    expect(c).toMatch(/20261106000000\) has not been applied/);
    expect(c).toMatch(/Apply 20261104000000_tournament_rated_and_match_runs\.sql first/);
  });

  it("sets rated on and leaves count_for_season off, and does not touch the app-wide rating switches", () => {
    expect(c).toMatch(/update public\.tournaments set rated = true, count_for_season = false where id = v_tid/);
    expect(c).not.toMatch(/app_flags|rating_v2|rating_results/);
    expect(rated).toMatch(/does not touch those switches/);
  });

  it("holds no real ids, names or emails", () => {
    expect(rated).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-(?!0{10})[0-9a-f]{12}/i);
    expect(rated).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});
