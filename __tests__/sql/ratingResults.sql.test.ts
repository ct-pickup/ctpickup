import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, resultSignals, type Session } from "../../lib/rating/ratingMath";
import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const HOST = uuid(950);
const RUN = uuid(960);
const TS = uuid(970);
const players = Array.from({ length: 10 }, (_, i) => ({ id: uuid(1000 + i), score: 40 + i * 4, team: i % 2 === 0 ? "A" : "B" }));
const A = players.filter((p) => p.team === "A");
const B = players.filter((p) => p.team === "B");

/** A 10 player game with a host who is not on a team, ready to settle, with the result row posted (unverified). */
function game(o: { winner?: "A" | "B" | "draw"; drop?: number; extraC?: boolean; flags?: string } = {}) {
  const winner = o.winner ?? "A";
  const list = o.drop ? players.slice(0, players.length - o.drop) : players;
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
    insert into public.session_attendance (session_id, user_id, status, organizer_score) values ${list.map((p) => `('${TS}', '${p.id}', 'attended', 5)`).join(",")};
    -- team assignments in order, so the first named player on each team is the captain
    ${players.map((p, i) => `insert into public.pickup_run_team_assignments (run_id, user_id, team, created_at) values ('${RUN}', '${p.id}', '${o.extraC && i === 9 ? "C" : p.team}', now() - interval '1 hour' + interval '${i} seconds');`).join("\n    ")}
    insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by) values ('${RUN}', 2, ${winner === "draw" ? "null" : `'${winner}'`}, '${HOST}');
    ${o.flags ?? "update public.app_flags set enabled = true where key in ('rating_v2', 'rating_results');"}
  `;
}
const settle = `select public.settle_session('${TS}');`;
const confirm = (team: "A" | "B", who?: string) => `insert into public.pickup_run_result_confirmations (run_id, team, result_version, confirmed_by) values ('${RUN}', '${team}', (select result_version from public.pickup_run_results where run_id = '${RUN}'), '${who ?? (team === "A" ? A[0]!.id : B[0]!.id)}');`;
const adjustments = `select user_id || '|' || delta from public.rating_result_adjustments where run_id = '${RUN}' order by user_id;`;
const scores = `select user_id || '|' || score from public.player_ratings where user_id in (${players.map((p) => `'${p.id}'`).join(",")}) order by user_id;`;
const lines = (xs: string[]) => xs.filter((l) => l.includes("|"));
const parse = (xs: string[]) => new Map(lines(xs).map((l) => { const [id, v] = l.split("|"); return [id!, Number(v)] as const; }));

/** The TypeScript twin's answer from what the database recorded for the settled game. */
function twin(winner: "A" | "B" | null, events: Map<string, { score_before: number; k: number }>) {
  const s: Session = {
    organizerId: HOST,
    attendees: players.map((p) => ({ id: p.id, score: events.get(p.id)!.score_before, sessions: 5, reliability: 92, organizerScore: 5 })),
    votes: [],
    result: { teams: Object.fromEntries(players.map((p) => [p.id, p.team as "A" | "B"])), winningTeam: winner, verified: true },
  };
  const sig = resultSignals(s, DEFAULT_CONFIG);
  return new Map(players.map((p) => [p.id, sig[p.id] === undefined ? 0 : Math.max(-2, Math.min(2, DEFAULT_CONFIG.result_k_share * events.get(p.id)!.k * sig[p.id]!))] as const));
}
const eventRows = `select user_id || '|' || score_before || '|' || k_factor from public.rating_events where session_id = '${TS}' order by user_id;`;
const readEvents = (xs: string[]) => new Map(lines(xs).map((l) => { const [id, sb, k] = l.split("|"); return [id!, { score_before: Number(sb), k: Number(k) }] as const; }));

describe.skipIf(!SQL_TESTS_ENABLED)("results as a protected input (real Postgres)", () => {
  it("the captain is the first player named on the team, never the host", () => {
    const out = sql(`${game()}
      select 'A|' || public.result_captain('${RUN}', 'A'); select 'B|' || public.result_captain('${RUN}', 'B');`);
    expect(lines(out)).toEqual([`A|${A[0]!.id}`, `B|${B[0]!.id}`]);
    const withHostFirst = sql(`${game()} insert into public.pickup_run_team_assignments (run_id, user_id, team, created_at) values ('${RUN}', '${HOST}', 'A', now() - interval '2 hours') on conflict do nothing; select 'A|' || public.result_captain('${RUN}', 'A');`);
    expect(lines(withHostFirst)).toEqual([`A|${A[0]!.id}`]);
  });
  it("an unconfirmed result changes nothing", () => {
    const out = sql(`${game()} ${settle} ${adjustments}`);
    expect(lines(out)).toEqual([]);
  });
  it("one team's confirmation is not enough", () => {
    const out = sql(`${game()} ${settle} ${confirm("A")} ${adjustments} select 'v|' || coalesce(verified_at::text, 'no') from public.pickup_run_results where run_id = '${RUN}';`);
    expect(lines(out)).toEqual([`v|no`].filter((l) => l.includes("|")));
  });
  it("both teams confirming after the game is settled moves each player as the TypeScript twin says", () => {
    const out = sql(`${game()} ${settle} ${scores} ${eventRows} ${confirm("A")} ${confirm("B")} ${scores} ${adjustments}`);
    const all = lines(out);
    const before = parse(all.slice(0, 10));
    const events = readEvents(all.slice(10, 20));
    const after = parse(all.slice(20, 30));
    const adj = parse(all.slice(30));
    const want = twin("A", events);
    for (const p of players) {
      expect(adj.get(p.id)!, `${p.id} adjustment`).toBeCloseTo(want.get(p.id)!, 1);
      expect(after.get(p.id)! - before.get(p.id)!, `${p.id} score change`).toBeCloseTo(adj.get(p.id)!, 2);
    }
    expect(A.every((p) => adj.get(p.id)! > 0) && B.every((p) => adj.get(p.id)! < 0)).toBe(true);
    expect(Math.max(...[...adj.values()].map(Math.abs))).toBeLessThanOrEqual(2);
  });
  it("a result confirmed before the game is settled counts when it is settled", () => {
    const out = sql(`${game()} ${confirm("A")} ${confirm("B")} ${settle} ${adjustments}`);
    expect(lines(out).length).toBe(10);
  });
  it("running the adjustment again does not count twice", () => {
    const out = sql(`${game()} ${settle} ${confirm("A")} ${confirm("B")} ${scores} select public.apply_result_rating('${RUN}'); select public.apply_result_rating('${RUN}'); ${scores}`);
    const all = lines(out);
    expect(all.slice(0, 10)).toEqual(all.slice(10, 20));
  });
  it("editing the winner reopens confirmation and takes the effect back out; confirming again counts the new result", () => {
    const mark = (n: string) => `select '@@|${n}';`;
    const out = sql(`${game()} ${settle} ${mark("settled")} ${scores}
      ${confirm("A")} ${confirm("B")}
      update public.pickup_run_results set winning_team = 'B' where run_id = '${RUN}';
      ${mark("version")} select 'version|' || result_version || '|' || coalesce(verified_at::text, 'open') from public.pickup_run_results where run_id = '${RUN}';
      ${mark("reopened")} ${scores} ${adjustments}
      ${confirm("A")} ${confirm("B")} ${mark("again")} ${adjustments}`);
    const section = (name: string) => {
      const all = out.filter((l) => l.includes("|"));
      const i = all.indexOf(`@@|${name}`);
      const rest = all.slice(i + 1);
      const j = rest.findIndex((l) => l.startsWith("@@|"));
      return j < 0 ? rest : rest.slice(0, j);
    };
    expect(section("version")).toEqual(["version|2|open"]);
    const settled = parse(section("settled"));
    const reopened = section("reopened");
    const scoresBack = parse(reopened.slice(0, 10));
    for (const p of players) expect(scoresBack.get(p.id)!, p.id).toBeCloseTo(settled.get(p.id)!, 2);
    expect(parse(reopened.slice(10)).get(A[0]!.id)).toBe(0);
    const again = parse(section("again"));
    expect(again.get(B[0]!.id)!).toBeGreaterThan(0); // B won the corrected result
    expect(again.get(A[0]!.id)!).toBeLessThan(0);
  });
  it("editing only the awards does not reopen it", () => {
    const out = sql(`${game()} ${settle} ${confirm("A")} ${confirm("B")}
      update public.pickup_run_results set player_of_day = '${A[0]!.id}' where run_id = '${RUN}';
      select 'version|' || result_version || '|' || (verified_at is not null) from public.pickup_run_results where run_id = '${RUN}';`);
    expect(lines(out)).toEqual(["version|1|true"]);
  });
  it("a draw between equal-average teams moves nobody much; a draw is not a win", () => {
    const out = sql(`${game({ winner: "draw" })} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`);
    const adj = parse(out);
    // team B is stronger on average, so a draw is a small gain for A and a small loss for B
    expect(A.every((p) => adj.get(p.id)! >= 0)).toBe(true);
    expect(B.every((p) => adj.get(p.id)! <= 0)).toBe(true);
  });
  it("nothing counts without both flags", () => {
    const off = sql(`${game({ flags: "update public.app_flags set enabled = true where key = 'rating_v2';" })} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`);
    expect(lines(off)).toEqual([]);
    const v1 = sql(`${game({ flags: "update public.app_flags set enabled = true where key = 'rating_results';" })} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`);
    expect(lines(v1)).toEqual([]); // rating_results alone does nothing
  });
  it("ignores games with too few attendees, uneven teams or a third team", () => {
    expect(lines(sql(`${game({ drop: 3 })} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`))).toEqual([]); // 7 attendees, minimum is 8
    expect(lines(sql(`${game({ drop: 3 })} update public.rating_config set value = 1 where key = 'result_min_attendance'; ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`)).length).toBeGreaterThan(0);
    const uneven = `update public.pickup_run_team_assignments set team = 'A' where run_id = '${RUN}' and user_id = '${B[4]!.id}';`; // A has 6, B has 4
    expect(lines(sql(`${game()} ${uneven} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`))).toEqual([]);
    expect(lines(sql(`${game({ extraC: true })} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`))).toEqual([]);
  });
  it("ignores a player when the host entered too many results involving them in 30 days", () => {
    const extra = Array.from({ length: 7 }, (_, i) => {
      const r = uuid(2000 + i);
      return `insert into public.pickup_runs (id, title, start_at, capacity, status, created_by) values ('${r}', 'old', now() - interval '${i + 3} days', 14, 'completed', '${HOST}');
        insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${r}', '${A[1]!.id}', 'A');
        insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, created_at) values ('${r}', 2, 'A', '${HOST}', now() - interval '${i + 3} days');`;
    }).join("\n");
    const out = sql(`${game()} ${extra} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`);
    const adj = parse(out);
    expect(adj.get(A[1]!.id) ?? 0).toBe(0); // 8 results by this host involve them, the limit is 6
    expect(adj.get(A[2]!.id)!).not.toBe(0);
  });
  it("posted_by is the first poster and survives edits that change created_by", () => {
    const other = uuid(951);
    const out = sql(`${game()} insert into auth.users (id) values ('${other}'); insert into public.profiles (id, approved) values ('${other}', true);
      select 'first|' || (posted_by = '${HOST}') from public.pickup_run_results where run_id = '${RUN}';
      update public.pickup_run_results set created_by = '${other}', winning_team = 'B' where run_id = '${RUN}';
      select 'after|' || (posted_by = '${HOST}') || '|' || (created_by = '${other}') from public.pickup_run_results where run_id = '${RUN}';`);
    expect(lines(out)).toEqual(["first|true", "after|true|true"]);
  });
  it("the host entry limit counts by who posted, not by who edited last", () => {
    const other = uuid(951);
    const old = (i: number, postedBy: string, createdBy: string) => {
      const r = uuid(2100 + i);
      return `insert into public.pickup_runs (id, title, start_at, capacity, status, created_by) values ('${r}', 'old', now() - interval '${i + 3} days', 14, 'completed', '${HOST}');
        insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${r}', '${A[1]!.id}', 'A');
        insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, posted_by, created_at) values ('${r}', 2, 'A', '${createdBy}', '${postedBy}', now() - interval '${i + 3} days');`;
    };
    const setup = `insert into auth.users (id) values ('${other}'); insert into public.profiles (id, approved) values ('${other}', true);`;
    // seven results HOST posted but an admin edited last: they still count against HOST
    const posted = Array.from({ length: 7 }, (_, i) => old(i, HOST, other)).join("\n");
    const a1 = parse(sql(`${game()} ${setup} ${posted} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`));
    expect(a1.get(A[1]!.id) ?? 0).toBe(0);
    // seven results someone else posted that HOST edited last: they do not count against HOST
    const edited = Array.from({ length: 7 }, (_, i) => old(i, other, HOST)).join("\n");
    const a2 = parse(sql(`${game()} ${setup} ${edited} ${settle} ${confirm("A")} ${confirm("B")} ${adjustments}`));
    expect(a2.get(A[1]!.id)!).not.toBe(0);
  });
  it("is closed to players", () => {
    expect(sqlError(`${game()} set local role authenticated; select public.apply_result_rating('${RUN}');`)).toMatch(/permission denied/);
    expect(sqlError(`${game()} set local role authenticated; select * from public.pickup_run_result_confirmations;`)).toMatch(/permission denied/);
  });
});
