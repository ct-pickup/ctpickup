import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const FILE = "20261103000100_profiles_hide_gender_columns.sql";
const raw = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const migration = raw
  .split("\n")
  .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l) && !/^\s*notify\s/i.test(l))
  .join("\n");

const A = uuid(1);
const B = uuid(2);

/** Supabase defaults: signed-in users hold table-wide SELECT on profiles, with the "approved directory" row policy; service_role has everything. */
const STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, first_name text, approved boolean not null default true, is_banned boolean not null default false,
                                sex text, gender text, gender_other text);
  alter table public.profiles enable row level security;
  create policy dir on public.profiles for select to authenticated using (approved = true and is_banned = false);
  create policy own_upd on public.profiles for update to authenticated using (id = auth.uid());
  grant select, insert, update on public.profiles to authenticated;
  grant all on public.profiles to service_role;
  insert into public.profiles (id, first_name, sex, gender, gender_other) values
    ('${A}', 'Ann', 'female', 'female', null), ('${B}', 'Bo', 'male', 'other', 'secret-other');
`;
const asUser = (id: string) => `reset role; set local request.jwt.claim.sub = '${id}'; set local role authenticated;`;

describe("profiles hide gender migration (file)", () => {
  it("warns loudly, is column level, has a rollback and is not applied by anything else", () => {
    expect(raw).toMatch(/NOT APPLIED ANYWHERE/);
    expect(raw).toMatch(/ROLLBACK/);
    expect(raw).toMatch(/column_name not in \('sex', 'gender', 'gender_other'\)/);
    expect(raw).toMatch(/security_invoker = false/);
    expect(raw).toMatch(/where p\.id = auth\.uid\(\)/);
    expect(FILE > "20261103000000_womens_leaderboard_opt_in.sql").toBe(true);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("profiles hide gender (real Postgres)", () => {
  const setup = `${STUB} ${migration}`;

  it("before the migration another signed-in user CAN read gender (the problem)", () => {
    expect(sql(`${STUB} ${asUser(A)} select gender from public.profiles where id = '${B}';`)).toEqual(["other"]);
  });
  it("after it, another signed-in user cannot read sex, gender or gender_other of anyone", () => {
    for (const col of ["sex", "gender", "gender_other"]) {
      expect(sqlError(`${setup} ${asUser(A)} select ${col} from public.profiles where id = '${B}';`), col).toMatch(/permission denied/i);
    }
  });
  it("the owner cannot read them from profiles either (they use the view), and select * is refused", () => {
    expect(sqlError(`${setup} ${asUser(A)} select gender from public.profiles where id = '${A}';`)).toMatch(/permission denied/i);
    expect(sqlError(`${setup} ${asUser(A)} select * from public.profiles;`)).toMatch(/permission denied/i);
  });
  it("every other column and the row policy still work for other users", () => {
    expect(sql(`${setup} ${asUser(A)} select first_name from public.profiles order by first_name;`)).toEqual(["Ann", "Bo"]);
  });
  it("the owner reads their own values from my_profile_identity, and never anyone else's", () => {
    const out = sql(`${setup}
      ${asUser(B)}
      select user_id || '|' || sex || '|' || gender || '|' || gender_other from public.my_profile_identity;
      select count(*) from public.my_profile_identity where user_id = '${A}';`);
    expect(out).toEqual([`${B}|male|other|secret-other`, "0"]);
  });
  it("the service role still reads everything, and anon reads nothing", () => {
    const out = sql(`${setup} reset role; set local role service_role; select count(*) from public.profiles where gender is not null;`);
    expect(out).toEqual(["2"]);
    expect(sqlError(`${setup} reset role; set local role anon; select gender from public.my_profile_identity;`)).toMatch(/permission denied/i);
  });
  it("owners can still write their own gender (update privilege untouched)", () => {
    const out = sql(`${setup} ${asUser(A)} update public.profiles set gender = 'other' where id = '${A}'; reset role; select gender from public.profiles where id = '${A}';`);
    expect(out).toEqual(["other"]);
  });
  it("can run twice, and works on a database that is behind (a column missing)", () => {
    expect(() => sql(`${setup} ${migration} select 1;`)).not.toThrow();
    const behind = STUB.replace(", gender_other text", "").replace("(id, first_name, sex, gender, gender_other)", "(id, first_name, sex, gender)").replace("'female', null)", "'female')").replace("'other', 'secret-other')", "'other')");
    expect(behind).not.toBe(STUB);
    const out = sql(`${behind} ${migration} ${asUser(A)} select first_name from public.profiles order by first_name; select gender_other from public.my_profile_identity;`);
    expect(out[0]).toBe("Ann");
    expect(out[1]).toBe("Bo");
  });
});
