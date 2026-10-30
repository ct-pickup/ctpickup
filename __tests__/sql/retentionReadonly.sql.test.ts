import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, uuid } from "./harness";

const file = readFileSync("scripts/dev/retention_metrics_readonly.sql", "utf8");
const code = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("scripts/dev/retention_metrics_readonly.sql", () => {
  it("is one SELECT and nothing that writes", () => {
    expect(code.trim().startsWith("with params")).toBe(true);
    expect(code.trim().endsWith(";")).toBe(true);
    expect(code.trim().slice(0, -1)).not.toContain(";");
    expect(code).not.toMatch(/\b(insert|update|delete|create|drop|alter|truncate|grant|revoke|copy|call|do|vacuum|set)\b\s/i);
  });
  it("reads only the four production tables", () => {
    const tables = [...code.matchAll(/\b(?:from|join)\s+(public\.[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(tables)].sort()).toEqual(["public.pickup_run_attendance", "public.pickup_run_rsvps", "public.pickup_runs", "public.profiles"]);
  });
  it("has the read-only header", () => {
    expect(file).toMatch(/READ ONLY/);
    expect(file).toMatch(/ONE SELECT statement/);
  });
});

const [U1, U2, U3] = [uuid(601), uuid(602), uuid(603)];
const [G1, G2, G3, G4] = [uuid(611), uuid(612), uuid(613), uuid(614)];

describe.skipIf(!SQL_TESTS_ENABLED)("retention_metrics_readonly.sql against fixtures (real Postgres)", () => {
  it("computes the headline numbers", () => {
    const out = sql(`
      alter table public.profiles add column if not exists created_at timestamptz default now();
      create table if not exists public.pickup_run_attendance (run_id uuid, user_id uuid, attended boolean);
      insert into auth.users (id) values ('${U1}'), ('${U2}'), ('${U3}');
      insert into public.profiles (id, created_at) values ('${U1}', now() - interval '100 days'), ('${U2}', now() - interval '100 days'), ('${U3}', now() - interval '100 days');
      -- four finished games in the last 60 days, capacity 10
      insert into public.pickup_runs (id, start_at, capacity, status) values
        ('${G1}', now() - interval '60 days', 10, 'completed'), ('${G2}', now() - interval '45 days', 10, 'completed'),
        ('${G3}', now() - interval '20 days', 10, 'completed'), ('${G4}', now() - interval '10 days', 10, 'cancelled');
      -- U1 plays G1 then G2 (back within 30 days). U2 plays only G1. U3 plays G3 (first game 20 days ago: not counted for the 30 day rate) and is a no-show at G2.
      insert into public.pickup_run_attendance values
        ('${G1}', '${U1}', true), ('${G2}', '${U1}', true), ('${G1}', '${U2}', true), ('${G3}', '${U3}', true), ('${G2}', '${U3}', false);
      -- fill is not exercised here: the rsvp stub needs a real user per row
      select second_game_30d_pct, n_players_30d_old, n_players_played, n_games, n_attendance_marks, no_show_pct, round(median_days_to_first_game) from (
        ${file.replace(/;\s*$/, "")}
      ) q;`);
    // 2 players are 30+ days past their first game (U1, U2): 1 came back = 50.0. 3 played. 3 finished games. 5 marks, 1 no-show = 20.0.
    // median days from account (100 days ago) to first game: U1 and U2 40, U3 80 -> 40.
    expect(out).toEqual(["50.0|2|3|3|5|20.0|40"]);
  });
});
