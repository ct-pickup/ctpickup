import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const FILE = "20261103000050_my_profile_identity_view.sql";
const raw = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const migration = raw
  .split("\n")
  .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l) && !/^\s*notify\s/i.test(l))
  .join("\n");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const A = uuid(1);
const B = uuid(2);
const STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table public.profiles (id uuid primary key, first_name text, approved boolean not null default true, sex text, gender text, gender_other text);
  alter table public.profiles enable row level security;
  create policy dir on public.profiles for select to authenticated using (approved = true);
  grant select on public.profiles to authenticated;
  grant all on public.profiles to service_role;
  insert into public.profiles (id, first_name, sex, gender, gender_other) values
    ('${A}', 'Ann', 'female', 'female', null), ('${B}', 'Bo', 'male', 'other', 'secret-other');
`;
const asUser = (id: string) => `reset role; set local request.jwt.claim.sub = '${id}'; set local role authenticated;`;

describe("my_profile_identity migration (file)", () => {
  it("creates only the view: no column privilege change, no policy, no table change, with a rollback", () => {
    expect(raw).toMatch(/ROLLBACK/);
    expect(code).toMatch(/create or replace view public\.my_profile_identity/i);
    expect(code).not.toMatch(/grant select \(|revoke select on public\.profiles|create policy|alter table|drop (table|column)|update |insert /i);
    expect(FILE < "20261103000100_profiles_hide_gender_columns.sql").toBe(true);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("my_profile_identity (real Postgres)", () => {
  const setup = `${STUB} ${migration}`;

  it("returns the signed-in player's own values and never anyone else's", () => {
    const out = sql(`${setup} ${asUser(B)}
      select user_id || '|' || sex || '|' || gender || '|' || gender_other from public.my_profile_identity;
      select count(*) from public.my_profile_identity where user_id = '${A}';`);
    expect(out).toEqual([`${B}|male|other|secret-other`, "0"]);
  });
  it("returns nothing without a signed-in user, and anon cannot read it", () => {
    expect(sql(`${setup} reset role; set local role service_role; select count(*) from public.my_profile_identity;`)).toEqual(["0"]);
    expect(sqlError(`${setup} reset role; set local role anon; select * from public.my_profile_identity;`)).toMatch(/permission denied/i);
  });
  it("changes nothing about who can read profiles (that is a later migration)", () => {
    expect(sql(`${setup} ${asUser(A)} select gender from public.profiles where id = '${B}';`)).toEqual(["other"]);
  });
  it("can run twice, and works on a database where a column is missing", () => {
    expect(() => sql(`${setup} ${migration} select 1;`)).not.toThrow();
    const behind = STUB.replace(", gender_other text", "").replace("(id, first_name, sex, gender, gender_other)", "(id, first_name, sex, gender)").replace("'female', null)", "'female')").replace("'other', 'secret-other')", "'other')");
    expect(behind).not.toBe(STUB);
    const out = sql(`${behind} ${migration} ${asUser(A)} select sex from public.my_profile_identity;`);
    expect(out).toEqual(["female"]);
  });
});
