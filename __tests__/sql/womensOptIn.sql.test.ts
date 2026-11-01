import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const FILE = "20261103000000_womens_leaderboard_opt_in.sql";
const raw = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const migration = raw
  .split("\n")
  .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l) && !/^\s*notify\s/i.test(l))
  .join("\n");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const A = uuid(1);
const B = uuid(2);

/** What every Supabase project has: the auth schema, auth.users and auth.uid() (from the JWT claim), and the three roles. Nothing else is assumed. */
const STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  insert into auth.users (id) values ('${A}'), ('${B}');
`;
const asUser = (id: string) => `reset role; set local request.jwt.claim.sub = '${id}'; set local role authenticated;`;

describe("womens_leaderboard_opt_in migration (file)", () => {
  it("has a rollback block, is a new private table, and only the owner can select, insert and delete", () => {
    expect(raw).toMatch(/ROLLBACK/);
    expect(raw).toMatch(/create table if not exists public\.womens_leaderboard_opt_in/i);
    expect(raw).toMatch(/user_id\s+uuid primary key references auth\.users \(id\) on delete cascade/i);
    expect(code).toMatch(/enable row level security/i);
    expect((code.match(/create policy/gi) ?? []).length).toBe(3);
    expect(code).toMatch(/for select to authenticated using \(auth\.uid\(\) = user_id\)/i);
    expect(code).toMatch(/for insert to authenticated with check \(auth\.uid\(\) = user_id\)/i);
    expect(code).toMatch(/for delete to authenticated using \(auth\.uid\(\) = user_id\)/i);
    expect(code).not.toMatch(/for update|for all|to anon|to public|using \(true\)/i);
  });
  it("never mentions gender, sex or the profiles table in code, and sorts after the earlier migrations", () => {
    expect(code).not.toMatch(/gender|\bsex\b|public\.profiles|player_cards/i);
    expect(FILE > "20261102000100_player_cards_attendance_reliability.sql").toBe(true);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("womens_leaderboard_opt_in (real Postgres)", () => {
  const setup = `${STUB} ${migration}`;

  it("starts empty: nobody is opted in", () => {
    expect(sql(`${setup} select count(*) from public.womens_leaderboard_opt_in;`)).toEqual(["0"]);
  });
  it("row level security is on and there are exactly three owner-only policies", () => {
    const out = sql(`${setup}
      select relrowsecurity::text from pg_class where oid = 'public.womens_leaderboard_opt_in'::regclass;
      select cmd || '|' || roles::text from pg_policies where tablename = 'womens_leaderboard_opt_in' order by cmd;`);
    expect(out[0]).toBe("true");
    expect(out.slice(1)).toEqual(["DELETE|{authenticated}", "INSERT|{authenticated}", "SELECT|{authenticated}"]);
  });
  it("a player can opt in and out for themselves", () => {
    const out = sql(`${setup}
      ${asUser(A)}
      insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');
      select user_id::text from public.womens_leaderboard_opt_in;
      delete from public.womens_leaderboard_opt_in where user_id = '${A}';
      select count(*) from public.womens_leaderboard_opt_in;`);
    expect(out).toEqual([A, "0"]);
  });
  it("another signed-in user cannot select anyone else's row", () => {
    const out = sql(`${setup}
      insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');
      ${asUser(B)}
      select count(*) from public.womens_leaderboard_opt_in;
      select count(*) from public.womens_leaderboard_opt_in where user_id = '${A}';
      reset role;
      ${asUser(A)}
      select count(*) from public.womens_leaderboard_opt_in;`);
    expect(out).toEqual(["0", "0", "1"]);
  });
  it("a player cannot opt someone else in, and cannot delete someone else's row", () => {
    expect(sqlError(`${setup} ${asUser(B)} insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');`)).toMatch(/row-level security/i);
    const out = sql(`${setup}
      insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');
      ${asUser(B)}
      with d as (delete from public.womens_leaderboard_opt_in where user_id = '${A}' returning 1) select count(*) from d;
      reset role;
      select count(*) from public.womens_leaderboard_opt_in;`);
    expect(out).toEqual(["0", "1"]);
  });
  it("nobody can update a row, and signed-out (anon) callers can do nothing", () => {
    expect(sqlError(`${setup} insert into public.womens_leaderboard_opt_in (user_id) values ('${A}'); ${asUser(A)} update public.womens_leaderboard_opt_in set created_at = now();`)).toMatch(/permission denied/i);
    expect(sqlError(`${setup} reset role; set local role anon; select * from public.womens_leaderboard_opt_in;`)).toMatch(/permission denied/i);
    expect(sqlError(`${setup} reset role; set local role anon; insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');`)).toMatch(/permission denied/i);
  });
  it("the service role (the leaderboard API) sees every row", () => {
    const out = sql(`${setup}
      insert into public.womens_leaderboard_opt_in (user_id) values ('${A}'), ('${B}');
      reset role; set local role service_role;
      select count(*) from public.womens_leaderboard_opt_in;`);
    expect(out).toEqual(["2"]);
  });
  it("one row per player, and deleting the account removes the row", () => {
    expect(sqlError(`${setup} insert into public.womens_leaderboard_opt_in (user_id) values ('${A}'), ('${A}');`)).toMatch(/duplicate key/i);
    const out = sql(`${setup}
      insert into public.womens_leaderboard_opt_in (user_id) values ('${A}');
      delete from auth.users where id = '${A}';
      select count(*) from public.womens_leaderboard_opt_in;`);
    expect(out).toEqual(["0"]);
  });
  it("can run twice without changing anything", () => {
    const out = sql(`${setup} insert into public.womens_leaderboard_opt_in (user_id) values ('${A}'); ${migration}
      select count(*) from public.womens_leaderboard_opt_in;
      select count(*) from pg_policies where tablename = 'womens_leaderboard_opt_in';`);
    expect(out).toEqual(["1", "3"]);
  });
});
