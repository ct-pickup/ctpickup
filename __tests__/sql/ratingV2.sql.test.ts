import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../../lib/rating/ratingMath";
import { SQL_TESTS_ENABLED, sql, sqlError } from "./harness";
import { PLAYERS, SESSION, expectedV1, expectedV2, fixtureSql } from "./ratingFixtures";

const run = (extra = "") => sql(`${fixtureSql()}
  ${extra}
  select public.settle_session('${SESSION}');
  select user_id || '|' || score_after || '|' || delta || '|' || engine from public.rating_events where session_id = '${SESSION}' order by user_id;`).filter((l) => l.includes("|"));

describe.skipIf(!SQL_TESTS_ENABLED)("settle_session_v2 (real Postgres)", () => {
  it("seeds every constant the TypeScript twin has, with the same value", () => {
    const rows = sql("select key || '=' || value from public.rating_config order by key;");
    const db = Object.fromEntries(rows.map((r) => r.split("=")).map(([k, v]) => [k, Number(v)]));
    for (const [k, v] of Object.entries(DEFAULT_CONFIG)) expect(db[k], k).toBeCloseTo(v, 6);
  });
  it("with the flag off, settle_session is the old formula (engine v1, no field columns)", () => {
    const out = run();
    expect(out.filter((l) => l.endsWith("|v1")).length).toBe(PLAYERS.length);
    const detail = sql(`${fixtureSql()} select public.settle_session('${SESSION}'); select count(*) from public.rating_events where session_id = '${SESSION}' and field_avg is not null;`);
    expect(detail.at(-1)).toBe("0");
    const want = new Map(expectedV1().map((o) => [o.id, o]));
    for (const line of out) {
      const [id, after] = line.split("|");
      expect(Number(after), `${id} v1 score`).toBeCloseTo(want.get(id!)!.scoreAfter, 1);
    }
  });
  it("with the flag on, v2 gives the same scores as the TypeScript twin", () => {
    const out = run("update public.app_flags set enabled = true where key = 'rating_v2';");
    expect(out.every((l) => l.endsWith("|v2"))).toBe(true);
    const want = new Map(expectedV2().map((o) => [o.id, o]));
    for (const line of out) {
      const [id, after, delta] = line.split("|");
      const w = want.get(id!)!;
      expect(Number(after), `${id} score`).toBeCloseTo(w.scoreAfter, 1);
      expect(Number(delta), `${id} delta`).toBeCloseTo(w.delta, 1);
    }
  });
  it("a constant changed in rating_config changes the result at once, no deploy", () => {
    const base = run("update public.app_flags set enabled = true where key = 'rating_v2';");
    const tuned = run("update public.app_flags set enabled = true where key = 'rating_v2'; update public.rating_config set value = 1000 where key = 'field_gain_scale';");
    expect(tuned).not.toEqual(base);
    const want = new Map(expectedV2({ field_gain_scale: 1000 }).map((o) => [o.id, o]));
    for (const line of tuned) {
      const [id, after] = line.split("|");
      expect(Number(after), id).toBeCloseTo(want.get(id!)!.scoreAfter, 1);
    }
  });
  it("fails loudly when a constant was deleted", () => {
    const err = sqlError(`${fixtureSql()} update public.app_flags set enabled = true where key = 'rating_v2'; delete from public.rating_config where key = 'pair_decay'; select public.settle_session('${SESSION}');`);
    expect(err).toMatch(/rating_config is missing pair_decay/);
  });
  it("writes the audit columns and updates the player ratings", () => {
    const out = sql(`${fixtureSql()} update public.app_flags set enabled = true where key = 'rating_v2';
      select public.settle_session('${SESSION}');
      select count(*) from public.rating_events where session_id = '${SESSION}' and engine = 'v2' and field_avg is not null and field_factor is not null and detail is not null;
      select state from public.tier_sessions where id = '${SESSION}';
      select count(*) from public.player_ratings pr join public.rating_events re on re.user_id = pr.user_id and re.session_id = '${SESSION}' where pr.score = re.score_after;
      select public.settle_session('${SESSION}');`);
    expect(out).toEqual([String(PLAYERS.length), String(PLAYERS.length), "settled", String(PLAYERS.length), "0"]);
  });
});
