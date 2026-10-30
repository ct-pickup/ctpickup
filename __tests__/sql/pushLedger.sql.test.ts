import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const U1 = uuid(101);
const U2 = uuid(102);
const seed = `insert into auth.users (id) values ('${U1}'), ('${U2}');`;

describe.skipIf(!SQL_TESTS_ENABLED)("push_ledger and claim_push_slots (real Postgres)", () => {
  it("hands out a slot once per user, then blocks the same event and the 6 hour window", () => {
    const out = sql(`${seed}
      select 'first', count(*) from public.claim_push_slots(array['${U1}','${U2}']::uuid[], 'new_games', 'game:a', 6);
      select 'same event', count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'new_games', 'game:a', 6);
      select 'other event, inside window', count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'new_games', 'game:b', 6);
      select 'other type', count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'slot_opens', 'game:b', 6);
      update public.push_ledger set sent_at = now() - interval '7 hours';
      select 'after the window', count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'new_games', 'game:c', 6);
      select 'old event is still blocked', count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'new_games', 'game:a', 6);`);
    expect(out).toEqual(["first|2", "same event|0", "other event, inside window|0", "other type|1", "after the window|1", "old event is still blocked|0"]);
  });
  it("ignores nulls and duplicates in the list and an empty list", () => {
    const out = sql(`${seed}
      select count(*) from public.claim_push_slots(array['${U1}','${U1}', null]::uuid[], 'x', 'k', 6);
      select count(*) from public.claim_push_slots(array[]::uuid[], 'x', 'k2', 6);
      select count(*) from public.claim_push_slots(null, 'x', 'k3', 6);`);
    expect(out).toEqual(["1", "0", "0"]);
  });
  it("players cannot read or write the ledger or call the function", () => {
    expect(sqlError(`${seed} set local role authenticated; select * from public.push_ledger;`)).toMatch(/permission denied/);
    expect(sqlError(`${seed} set local role authenticated; select * from public.claim_push_slots(array['${U1}']::uuid[], 'x', 'k', 6);`)).toMatch(/permission denied/);
    expect(sqlError(`${seed} set local role anon; insert into public.push_ledger (user_id, bucket, dedupe_key) values ('${U1}', 'x', 'k');`)).toMatch(/permission denied/);
  });
  it("a bad bucket name is refused", () => {
    expect(sqlError(`${seed} insert into public.push_ledger (user_id, bucket, dedupe_key) values ('${U1}', 'Bad Bucket', 'k');`)).toMatch(/check constraint/);
  });
  it("deleting a user leaves no linkable id in the ledger", () => {
    const out = sql(`${seed}
      select count(*) from public.claim_push_slots(array['${U1}']::uuid[], 'x', 'k', 6);
      delete from auth.users where id = '${U1}';
      select count(*) from public.push_ledger where user_id = '${U1}';`);
    expect(out).toEqual(["1", "0"]);
  });
});

describe.skipIf(!SQL_TESTS_ENABLED)("retention flags and push preferences (real Postgres)", () => {
  it("the four new flags exist and are OFF", () => {
    const out = sql(`select key, enabled from public.app_flags where key in ('notification_settings','analytics_client','play_again','host_follow_alerts') order by key;`);
    expect(out).toEqual(["analytics_client|f", "host_follow_alerts|f", "notification_settings|f", "play_again|f"]);
  });
  it("profiles default to every category on, marketing off, quiet hours off at 22:00 to 07:00", () => {
    const out = sql(`insert into auth.users (id) values ('${U1}'); insert into public.profiles (id) values ('${U1}');
      select push_cat_games, push_cat_reminders, push_cat_results, push_cat_chat, push_cat_fields, marketing_push_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_tz is null from public.profiles where id = '${U1}';`);
    expect(out).toEqual(["t|t|t|t|t|f|f|1320|420|t"]);
  });
  it("quiet hour minutes outside 0..1439 and absurd zone names are refused", () => {
    const base = `insert into auth.users (id) values ('${U1}'); insert into public.profiles (id) values ('${U1}');`;
    expect(sqlError(`${base} update public.profiles set quiet_hours_start = 1440 where id = '${U1}';`)).toMatch(/profiles_quiet_hours_range/);
    expect(sqlError(`${base} update public.profiles set quiet_hours_end = -1 where id = '${U1}';`)).toMatch(/profiles_quiet_hours_range/);
    expect(sqlError(`${base} update public.profiles set quiet_hours_tz = repeat('x', 65) where id = '${U1}';`)).toMatch(/profiles_quiet_hours_range/);
    expect(sqlError(`${base} update public.profiles set quiet_hours_start = 0, quiet_hours_end = 1439, quiet_hours_tz = 'America/Chicago' where id = '${U1}';`)).toBeNull();
  });
});
