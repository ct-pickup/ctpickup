import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, uuid } from "./harness";

const file = readFileSync("scripts/dev/rating_results_backtest_readonly.sql", "utf8");
const code = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/** The statement with string literals blanked, so only real SQL words are inspected. */
const bare = code.replace(/'(?:[^']|'')*'/g, "''");

describe("scripts/dev/rating_results_backtest_readonly.sql", () => {
  it("is one SELECT and nothing that writes", () => {
    expect(code.trim().startsWith("with params")).toBe(true);
    expect(code.trim().endsWith(";")).toBe(true);
    expect(bare.trim().slice(0, -1)).not.toContain(";");
    expect(bare).not.toMatch(/\b(insert|update|delete|create|drop|alter|truncate|grant|revoke|copy|call|do|vacuum|set)\b\s/i);
    expect(file).toMatch(/READ ONLY/);
    expect(file).toMatch(/ONE SELECT statement/);
  });
  it("reads only tables production already has", () => {
    const tables = [...code.matchAll(/\b(?:from|join)\s+(public\.[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(tables)].sort()).toEqual(["public.pickup_run_results", "public.pickup_run_team_assignments", "public.pickup_runs", "public.player_ratings", "public.rating_events"]);
  });
});

const HOST = uuid(950);
const players = Array.from({ length: 10 }, (_, i) => ({ id: uuid(1000 + i), score: 40 + i * 4, team: i % 2 === 0 ? "A" : "B" }));

/** n games with the same 10 players; team B (the stronger average) wins `bWins` of them. */
function games(n: number, bWins: number) {
  const out: string[] = [`
    alter table public.pickup_runs add column if not exists tier_session_id uuid;
    insert into auth.users (id) values ('${HOST}'), ${players.map((p) => `('${p.id}')`).join(",")};
    insert into public.profiles (id, approved) values ('${HOST}', true), ${players.map((p) => `('${p.id}', true)`).join(",")};
    insert into public.player_ratings (user_id, score, sessions, reliability) values ${players.map((p) => `('${p.id}', ${p.score}, 5, 92)`).join(",")};`];
  for (let g = 0; g < n; g++) {
    const run = uuid(3000 + g), ts = uuid(4000 + g);
    out.push(`insert into public.pickup_runs (id, title, start_at, capacity, status, created_by) values ('${run}', 'g', now() - interval '${g + 1} days', 14, 'completed', '${HOST}');
      insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${ts}', '${HOST}', 'v', now() - interval '${g + 1} days', 20, 'settled');
      update public.pickup_runs set tier_session_id = '${ts}' where id = '${run}';
      insert into public.rating_events (session_id, user_id, votes_received, votes_expected, organizer_score, peer_weight, k_factor, delta, score_before, score_after, created_at)
        values ${players.map((p) => `('${ts}', '${p.id}', 0, 1, 5, 0.5, 16, 0, ${p.score}, ${p.score}, now() - interval '${g + 1} days')`).join(",")};
      insert into public.pickup_run_team_assignments (run_id, user_id, team) values ${players.map((p) => `('${run}', '${p.id}', '${p.team}')`).join(",")};
      insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, created_at) values ('${run}', 2, '${g < bWins ? "B" : "A"}', '${HOST}', now() - interval '${g + 1} days');`);
  }
  return out.join("\n");
}

describe.skipIf(!SQL_TESTS_ENABLED)("backtest against fixtures (real Postgres)", () => {
  it("measures how often the stronger team won and how many results would be eligible", () => {
    const rows = sql(`${games(10, 7)} ${file.replace(/;\s*$/, "")} ;`).filter((l) => l.includes("|"));
    const get = (section: string, metric: string) => rows.find((l) => l.startsWith(`${section}|${metric}|`))?.split("|");
    expect(get("games", "results posted")![2]).toBe("10");
    expect(get("accuracy", "stronger team won, all games")![2]).toBe("70.0%"); // B averages 60, A 56: B won 7 of 10
    expect(get("accuracy", "stronger team won, all games")![3]).toBe("10");
    expect(get("eligible", "results passing the structural rules (settled, two teams, minimum attendance, even teams)")![2]).toBe("10");
    expect(get("accuracy", "1) edge under 5 points")![2]).toBe("70.0%");
    expect(get("ratings", "players rated")![2]).toBe("10");
  });
  it("a host who entered more than 6 results for the same players has them set aside", () => {
    const rows = sql(`${games(8, 4)} ${file.replace(/;\s*$/, "")} ;`).filter((l) => l.includes("|"));
    const line = rows.find((l) => l.startsWith("eligible|player slots a host entry limit would set aside|"))!.split("|");
    expect(Number(line[2])).toBeGreaterThan(0);
  });
  it("runs on an empty database", () => {
    const rows = sql(`${file.replace(/;\s*$/, "")} ;`).filter((l) => l.includes("|"));
    expect(rows.find((l) => l.startsWith("games|results posted|"))!.split("|")[2]).toBe("0");
  });
});
