import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const FILE = "20261103000000_womens_leaderboard_opt_in.sql";
const raw = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const migration = raw
  .split("\n")
  .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l) && !/^\s*notify\s/i.test(l))
  .join("\n");

/** The smallest profiles table every environment has, with rows from before the migration. DEV may be behind, so nothing else is assumed. */
const STUB = `
  create table if not exists public.profiles (id uuid primary key, approved boolean not null default false, is_banned boolean not null default false);
  insert into public.profiles (id, approved) values ('${uuid(1)}', true), ('${uuid(2)}', true);
`;
const A = uuid(1);
const B = uuid(2);

describe("womens_leaderboard_opt_in migration (file)", () => {
  it("is additive, has a rollback block, and never mentions gender or the player_cards view", () => {
    expect(raw).toMatch(/ROLLBACK/);
    expect(raw).toMatch(/add column if not exists womens_leaderboard_opt_in boolean not null default false/i);
    const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/gender|\bsex\b/i);
    expect(code).not.toMatch(/player_cards|create (or replace )?view|drop (table|column)/i);
  });
  it("sorts after the previous migration", () => {
    expect(FILE > "20261102000100_player_cards_attendance_reliability.sql").toBe(true);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("womens_leaderboard_opt_in (real Postgres)", () => {
  it("existing profiles default to false (nobody is opted in) and the column is not null", () => {
    const out = sql(`${STUB} ${migration}
      select id || '|' || womens_leaderboard_opt_in from public.profiles order by id;
      select is_nullable || '|' || column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'womens_leaderboard_opt_in';`).filter((l) => l.includes("|"));
    expect(out).toEqual([`${A}|false`, `${B}|false`, "NO|false"]);
  });
  it("a new profile is not opted in, and null is refused", () => {
    const out = sql(`${STUB} ${migration}
      insert into public.profiles (id, approved) values ('${uuid(3)}', true);
      select womens_leaderboard_opt_in from public.profiles where id = '${uuid(3)}';`);
    expect(out).toEqual(["f"]);
    expect(sqlError(`${STUB} ${migration} update public.profiles set womens_leaderboard_opt_in = null where id = '${A}';`)).toMatch(/null value/i);
  });
  it("a player can be switched on and off", () => {
    const out = sql(`${STUB} ${migration}
      update public.profiles set womens_leaderboard_opt_in = true where id = '${A}';
      select id || '|' || womens_leaderboard_opt_in from public.profiles order by id;
      update public.profiles set womens_leaderboard_opt_in = false where id = '${A}';
      select count(*) from public.profiles where womens_leaderboard_opt_in;`).filter((l) => l !== "");
    expect(out).toEqual([`${A}|true`, `${B}|false`, "0"]);
  });
  it("can run twice, and adds only the one column and a partial index", () => {
    expect(() => sql(`${STUB} ${migration} ${migration} select 1;`)).not.toThrow();
    const cols = sql(`${STUB} ${migration} select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;`);
    expect(cols).toEqual(["id", "approved", "is_banned", "womens_leaderboard_opt_in"]);
    const idx = sql(`${STUB} ${migration} select indexdef from pg_indexes where indexname = 'profiles_womens_leaderboard_opt_in_idx';`);
    expect(idx[0]).toMatch(/WHERE womens_leaderboard_opt_in/);
  });
});
