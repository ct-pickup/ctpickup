import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, uuid } from "./harness";

const read = (f: string) =>
  readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(begin|commit);\s*$/i.test(l) && !/^\s*notify\s/i.test(l))
    .join("\n");

/** What production has before this migration: the tables player_cards reads and the legacy-columns view. */
const STUBS = `do $$ begin create type verification_level as enum ('self','instagram','verified'); exception when duplicate_object then null; end $$;
create table if not exists public.player_ratings (user_id uuid primary key, score numeric(5,2) not null default 50, tier text, verification verification_level not null default 'self', sessions integer not null default 0, reliability numeric(5,2) not null default 92, star_rating numeric(2,1) not null default 2.0, star_provisional boolean not null default true);
create table if not exists public.rating_events (id bigserial primary key, user_id uuid not null);
create table if not exists public.star_bands (star numeric(2,1) primary key, lower numeric(5,2) not null, upper numeric(5,2), requires_verified boolean not null default false, min_reliability numeric(5,2));
insert into public.star_bands (star, lower, upper, requires_verified, min_reliability) values
  (0.5,0,20,false,null),(1.0,20,40,false,null),(1.5,40,50,false,null),(2.0,50,60,false,null),(2.5,60,69,false,null),(3.0,69,78,false,null),
  (3.5,78,84,true,null),(4.0,84,90,true,null),(4.5,90,95,true,85),(5.0,95,null,true,85) on conflict (star) do nothing;
alter table public.star_bands enable row level security;
revoke all on table public.star_bands from anon, authenticated;
create or replace function public.star_provisional_events() returns integer language sql immutable as $b$ select 5; $b$;
revoke execute on function public.star_provisional_events() from public, anon, authenticated;
alter table public.player_ratings enable row level security;
revoke all on public.player_ratings, public.rating_events from anon, authenticated;
`;
const BEFORE = `${STUBS}\n${read("20261002230000_player_cards_legacy_columns.sql")}`;
const MID = `${BEFORE}\n${read("20261102000000_player_cards_exact_rating.sql")}`;
const AFTER = `${MID}\n${read("20261102000100_player_cards_attendance_reliability.sql")}`;

const U = (n: number) => uuid(8000 + n);
const player = (n: number, score: number, star: number, verification = "verified", reliability = 92) =>
  `insert into public.player_ratings (user_id, score, star_rating, verification, reliability, tier, sessions) values ('${U(n)}', ${score}, ${star}, '${verification}', ${reliability}, 'gold', 3);`;
const exact = (score: number, star: number) =>
  Number(sql(`${AFTER} select public.star_exact(${score}, ${star});`).pop());

describe.skipIf(!SQL_TESTS_ENABLED)("player_cards exact rating (real Postgres)", () => {
  it("keeps the legacy columns first and in order, and appends the new ones", () => {
    const cols = (s: string) => sql(`${s} select attname from pg_attribute where attrelid = 'public.player_cards'::regclass and attnum > 0 and not attisdropped order by attnum;`);
    const before = cols(BEFORE);
    const after = cols(AFTER);
    expect(before).toEqual(["user_id", "star_rating", "star_provisional", "percentile", "tier", "verification", "sessions", "reliability"]);
    const mid = cols(MID);
    expect(mid).toEqual([...before, "rating_exact", "rated_games", "settled_games"]);
    // The second migration appends exactly one more column and leaves the first eleven alone.
    expect(after).toEqual([...mid, "attendance_reliability"]);
  });
  it("leaves owner, options and grants exactly as they were", () => {
    const meta = (s: string) => sql(`${s} select pg_get_userbyid(relowner) || '|' || coalesce(reloptions::text, '-') || '|' || coalesce(relacl::text, '-') from pg_class where oid = 'public.player_cards'::regclass;`);
    expect(meta(AFTER)).toEqual(meta(BEFORE));
    expect(meta(AFTER)[0]).toContain("security_invoker=false");
    expect(meta(AFTER)[0]).toContain("authenticated=r/");
  });
  it("can be run twice", () => {
    // Each file can be run again right after itself. (Re-running the FIRST file after the second is applied is refused by Postgres,
    // which will not drop the newer column from a view; the transaction rolls back and nothing changes.)
    expect(() => sql(`${MID}\n${read("20261102000000_player_cards_exact_rating.sql")} select 1;`)).not.toThrow();
    expect(() => sql(`${AFTER}\n${read("20261102000100_player_cards_attendance_reliability.sql")} select 1;`)).not.toThrow();
  });
  it("places a score inside its band and always rounds back to the stored star", () => {
    expect(exact(78, 3.5)).toBe(3.26);
    expect(exact(81, 3.5)).toBe(3.5);
    expect(exact(83.99, 3.5)).toBeCloseTo(3.74, 2);
    expect(exact(95, 5.0)).toBe(4.76);
    expect(exact(100, 5.0)).toBe(5);
    expect(exact(0, 0.5)).toBe(0.5);
    expect(exact(20, 0.5)).toBe(0.74);
    for (const [score, star] of [[69, 3.0], [77.9, 3.0], [50, 2.0], [59.9, 2.0], [90, 4.5], [94.9, 4.5], [40, 1.5], [95, 5.0], [100, 5.0], [0, 0.5], [19.9, 0.5]] as const) {
      const v = exact(score, star);
      expect(Math.round(v * 2) / 2, `${score} -> ${v}`).toBe(star);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
  it("clamps to the band of the stored star when a cap or hysteresis holds the star away from the score", () => {
    expect(exact(88, 3.5)).toBe(3.74); // unverified at 88: capped at 3.5
    expect(exact(75, 3.5)).toBe(3.26); // held at 3.5 just under its band
    expect(sql(`${AFTER} select coalesce(public.star_exact(50, 9.5)::text, 'null');`)).toEqual(["null"]); // no such band
  });
  it("gives a signed-in player the new columns without exposing the score, and counts games against the provisional rule", () => {
    const out = sql(`${AFTER}
      ${player(1, 81, 3.5)} ${player(2, 30, 1.0)}
      insert into public.rating_events (user_id) values ('${U(1)}'), ('${U(1)}'), ('${U(1)}'), ('${U(1)}'), ('${U(1)}'), ('${U(1)}');
      set local role authenticated;
      select user_id || '|' || star_rating || '|' || rating_exact || '|' || rated_games || '|' || settled_games from public.player_cards order by user_id;`).filter((l) => l.includes("|"));
    expect(out).toEqual([`${U(1)}|3.5|3.50|6|5`, `${U(2)}|1.0|1.00|0|5`]);
  });
  it("attendance_reliability is the rounded show-up reliability, 0 to 100, and the legacy reliability column is unchanged", () => {
    const out = sql(`${AFTER}
      ${player(1, 81, 3.5, "verified", 92)} ${player(2, 30, 1.0, "verified", 92.6)} ${player(3, 30, 1.0, "verified", 0)} ${player(4, 30, 1.0, "verified", 100)}
      set local role authenticated;
      select user_id || '|' || reliability || '|' || attendance_reliability from public.player_cards order by user_id;`).filter((l) => l.includes("|"));
    expect(out).toEqual([`${U(1)}|92|92`, `${U(2)}|93|93`, `${U(3)}|0|0`, `${U(4)}|100|100`]);
  });
  it("a player cannot read the raw score or the band table through the view", () => {
    expect(() => sql(`${AFTER} set local role authenticated; select score from public.player_cards;`)).toThrow();
    expect(() => sql(`${AFTER} set local role authenticated; select * from public.star_bands;`)).toThrow();
    expect(() => sql(`${AFTER} set local role anon; select * from public.player_cards;`)).toThrow();
  });
});
