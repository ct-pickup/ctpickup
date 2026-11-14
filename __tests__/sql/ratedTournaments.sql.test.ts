import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

/**
 * Rated tournaments against a real Postgres (see harness.ts: set TEST_DATABASE_URL to a scratch database, never production).
 * Needs the rating migrations, 20261104000000 and 20261106000000, plus stand-ins for the production tournament tables.
 * Every script runs inside BEGIN ... ROLLBACK.
 */

const ADMIN = uuid(5000);
const TOUR = uuid(5001);
const BYSTANDER = uuid(5002);
const team = (t: number) => uuid(5200 + t);
const captain = (t: number) => uuid(6000 + t * 100);
const rostered = (t: number, i: number) => uuid(6000 + t * 100 + i + 1);
const match = (n: number) => uuid(7000 + n);

type M = {
  n: number;
  a?: number;
  b?: number;
  sa?: number | null;
  sb?: number | null;
  winner?: number | null; // team index
  bye?: boolean;
  /** Eastern wall clock "2026-11-14 15:00" */
  at?: string | null;
};
type W = {
  /** Players on each team, captain included. */
  sizes?: number[];
  rated?: boolean;
  season?: boolean;
  flags?: boolean;
  matches?: M[];
  score?: number;
  sessions?: number;
  /** Extra roster rows that are not accepted (invited) or belong to nobody. */
  invited?: boolean;
};

function players(w: W): string[] {
  const sizes = w.sizes ?? [5, 5];
  const out: string[] = [];
  sizes.forEach((size, t) => {
    out.push(captain(t));
    for (let i = 0; i < size - 1; i++) out.push(rostered(t, i));
  });
  return out;
}

/** A tournament with teams, rated players and matches. The matches are inserted already scored (that is what the admin route leaves behind). */
function world(w: W = {}): string {
  const sizes = w.sizes ?? [5, 5];
  const all = players(w);
  const ms = w.matches ?? [];
  const score = w.score ?? 50;
  const sessions = w.sessions ?? 0;
  return `
    insert into auth.users (id) values ('${ADMIN}'), ('${BYSTANDER}'), ${all.map((p) => `('${p}')`).join(",")};
    insert into public.profiles (id, approved, is_admin) values ('${ADMIN}', true, true), ('${BYSTANDER}', true, false), ${all.map((p) => `('${p}', true, false)`).join(",")};
    insert into public.player_ratings (user_id, score, sessions, reliability) values ('${BYSTANDER}', ${score}, ${sessions}, 92), ${all.map((p) => `('${p}', ${score}, ${sessions}, 92)`).join(",")};
    insert into public.tournaments (id, title, slug, rated, count_for_season) values ('${TOUR}', 't', 'test-rated', ${w.rated ?? true}, ${w.season ?? false});
    ${sizes.map((size, t) => `
      insert into public.tournament_captains (id, tournament_id, user_id, team_name) values ('${team(t)}', '${TOUR}', '${captain(t)}', 'Team ${t}');
      ${Array.from({ length: size - 1 }, (_, i) => `insert into public.tournament_roster (captain_id, user_id, status) values ('${team(t)}', '${rostered(t, i)}', 'accepted');`).join("\n")}`).join("\n")}
    ${w.invited ? `insert into public.tournament_roster (captain_id, user_id, status) values ('${team(0)}', '${BYSTANDER}', 'invited');` : ""}
    ${ms.map((m) => `insert into public.tournament_matches (id, tournament_id, stage, match_number, team_a_id, team_b_id, score_a, score_b, winner_id, is_bye, completed_at)
        values ('${match(m.n)}', '${TOUR}', 'group', ${m.n}, '${team(m.a ?? 0)}', '${team(m.b ?? 1)}', ${m.sa ?? "null"}, ${m.sb ?? "null"},
                ${m.winner == null ? "null" : `'${team(m.winner)}'`}, ${m.bye ? "true" : "false"},
                ${m.at === null ? "null" : `timestamp '${m.at ?? "2026-11-14 15:00"}' at time zone 'America/New_York'`});`).join("\n")}
    update public.app_flags set enabled = ${w.flags === false ? "false" : "true"} where key in ('rating_v2', 'rating_results');
  `;
}

const sync = (n: number) => `select 'sync${n}|' || public.tournament_sync_match('${match(n)}', '${ADMIN}')::text;`;
const rating = (u: string) => `select 'r|${u}|' || score || '|' || reliability || '|' || sessions from public.player_ratings where user_id = '${u}';`;
const ratingsOf = (us: string[]) => us.map(rating).join("\n");

const find = (xs: string[], prefix: string) => xs.find((l) => l.startsWith(prefix));
const sync_json = (xs: string[], n: number) => JSON.parse(find(xs, `sync${n}|`)!.slice(`sync${n}|`.length)) as { status: string; counted: boolean; reason: string | null };
const ratingMap = (xs: string[]) => new Map(xs.filter((l) => l.startsWith("r|")).map((l) => { const [, u, s, rel, ses] = l.split("|"); return [u!, { score: Number(s), reliability: Number(rel), sessions: Number(ses) }] as const; }));

/** An ordinary (not tournament) settled, verified game posted by the admin with the same ten players, teams A and B. */
const ordinaryGame = () => `
  insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8200)}', 'g', 'completed', now() - interval '2 hours', '${ADMIN}');
  insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${uuid(8201)}', '${ADMIN}', 'v', now() - interval '2 hours', 20, 'settled');
  update public.pickup_runs set tier_session_id = '${uuid(8201)}' where id = '${uuid(8200)}';
  ${players({ sizes: [5, 5] }).map((p, i) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, peer_weight, k_factor, delta, score_before, score_after) values ('${uuid(8201)}', '${p}', 0, 0, 0, 16, 0, 50, 50);
    insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8200)}', '${p}', '${i < 5 ? "A" : "B"}');`).join("\n")}
  insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, verified_at) values ('${uuid(8200)}', 2, 'A', '${ADMIN}', now());`;

const A = (w: W = {}) => players({ sizes: w.sizes ?? [5, 5] }).slice(0, (w.sizes ?? [5, 5])[0]!);
const B = (w: W = {}) => players({ sizes: w.sizes ?? [5, 5] }).slice((w.sizes ?? [5, 5])[0]!);

describe.skipIf(!SQL_TESTS_ENABLED)("rated tournaments (real Postgres)", () => {
  it("1. a tournament that is not rated changes nothing: no record, no session, no rating", () => {
    const w: W = { rated: false, season: false, matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}
      select 'runs|' || count(*) from public.pickup_runs;
      select 'links|' || count(*) from public.tournament_match_runs;
      select 'days|' || count(*) from public.tournament_rating_days;
      select 'events|' || count(*) from public.rating_events;
      select 'adj|' || count(*) from public.rating_result_adjustments;`);
    expect(sync_json(out, 1).status).toBe("off");
    for (const r of ratingMap(out).values()) expect(r.score).toBe(50);
    expect(find(out, "runs|")).toBe("runs|0");
    expect(find(out, "links|")).toBe("links|0");
    expect(find(out, "days|")).toBe("days|0");
    expect(find(out, "events|")).toBe("events|0");
    expect(find(out, "adj|")).toBe("adj|0");
  });

  it("1b. the same tournament while the rating switches are off: nothing moves, and the result says why", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }], flags: false };
    const out = sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))} select 'days|' || count(*) from public.tournament_rating_days;`);
    const j = sync_json(out, 1);
    expect(j.counted).toBe(false);
    expect(j.reason).toBe("ratings_off");
    for (const r of ratingMap(out).values()) expect(r.score).toBe(50);
    expect(find(out, "days|")).toBe("days|0");
  });

  it("2. a decisive match moves winners up and losers down, by no more than the per game cap", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}`);
    const j = sync_json(out, 1);
    expect(j).toMatchObject({ status: "counted", counted: true, reason: null });
    const r = ratingMap(out);
    for (const p of A(w)) { expect(r.get(p)!.score).toBeGreaterThan(50); expect(r.get(p)!.score - 50).toBeLessThanOrEqual(2); }
    for (const p of B(w)) { expect(r.get(p)!.score).toBeLessThan(50); expect(50 - r.get(p)!.score).toBeLessThanOrEqual(2); }
    // equal teams, k = 16 for a new player, 15% share, expectation 0.5: 0.15 x 16 x 0.5 = 1.2 each way
    expect(r.get(A(w)[0]!)!.score).toBe(51.2);
    expect(r.get(B(w)[0]!)!.score).toBe(48.8);
  });

  it("2b. one rating session for the whole day, a second one for another day (Eastern calendar day)", () => {
    const w: W = {
      matches: [
        { n: 1, sa: 2, sb: 0, at: "2026-11-14 10:00" },
        { n: 2, sa: 1, sb: 0, at: "2026-11-14 23:30" },
        { n: 3, sa: 1, sb: 0, at: "2026-11-15 00:30" },
      ],
    };
    const out = sql(`${world(w)} ${sync(1)} ${sync(2)} ${sync(3)}
      select 'sessions|' || count(distinct tier_session_id) from public.tournament_rating_days;
      select 'day|' || day || '|' || (select count(*) from public.pickup_runs r where (to_jsonb(r) ->> 'tier_session_id') = d.tier_session_id::text) from public.tournament_rating_days d order by day;
      select 'tiers|' || count(*) from public.tier_sessions where venue = 'Tournament day';
      select 'oneplayer|' || count(*) from public.rating_events where user_id = '${captain(0)}';`);
    expect(find(out, "sessions|")).toBe("sessions|2");
    expect(find(out, "tiers|")).toBe("tiers|2");
    const days = out.filter((l) => l.startsWith("day|"));
    expect(days).toEqual(["day|2026-11-14|2", "day|2026-11-15|1"]);
    expect(find(out, "oneplayer|")).toBe("oneplayer|2"); // one event per day, not one per match
  });

  it("3. the daily cap: total movement across one day stops at the cap, and the cap is one named number", () => {
    const w: W = { matches: [1, 2, 3, 4, 5].map((n) => ({ n, sa: 2, sb: 0, at: `2026-11-14 1${n}:00` })) };
    const out = sql(`${world(w)} select 'cap|' || public.tournament_daily_max_delta(); ${[1, 2, 3, 4, 5].map(sync).join("\n")} ${ratingsOf([captain(0), captain(1)])}`);
    expect(find(out, "cap|")).toBe("cap|3");
    const r = ratingMap(out);
    expect(r.get(captain(0))!.score).toBe(53); // five wins of 1.2 would be 56
    expect(r.get(captain(1))!.score).toBe(47);
    // the same five on five different days are not capped
    const spread: W = { matches: [1, 2, 3, 4, 5].map((n) => ({ n, sa: 2, sb: 0, at: `2026-11-1${n} 15:00` })) };
    const out2 = sql(`${world(spread)} ${[1, 2, 3, 4, 5].map(sync).join("\n")} ${ratingsOf([captain(0)])}`);
    expect(ratingMap(out2).get(captain(0))!.score).toBeGreaterThan(53.5);
  });

  it("3b. the cap comes from the rating_config row: change it and the cap follows", () => {
    const w: W = { matches: [1, 2, 3].map((n) => ({ n, sa: 2, sb: 0, at: `2026-11-14 1${n}:00` })) };
    const out = sql(`${world(w)} update public.rating_config set value = 1.5 where key = 'tournament_daily_max_delta'; ${[1, 2, 3].map(sync).join("\n")} ${ratingsOf([captain(0)])}`);
    expect(ratingMap(out).get(captain(0))!.score).toBe(51.5);
  });

  it("8. saving the same score twice, or editing a score, never stacks", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const once = ratingMap(sql(`${world(w)} ${sync(1)} ${ratingsOf(players(w))}`));
    const twice = ratingMap(sql(`${world(w)} ${sync(1)} ${sync(1)} ${sync(1)} ${ratingsOf(players(w))}`));
    expect([...twice.entries()]).toEqual([...once.entries()]);

    // edit the score so the other team wins: the ratings equal a world where that was the score all along
    const edited = ratingMap(sql(`${world(w)} ${sync(1)} update public.tournament_matches set score_a = 0, score_b = 2 where id = '${match(1)}'; ${sync(1)} ${sync(1)} ${ratingsOf(players(w))}`));
    const direct = ratingMap(sql(`${world({ matches: [{ n: 1, sa: 0, sb: 2 }] })} ${sync(1)} ${ratingsOf(players(w))}`));
    expect([...edited.entries()]).toEqual([...direct.entries()]);
    expect(edited.get(captain(1))!.score).toBeGreaterThan(50);
  });

  it("8b. editing an early match of a capped day re-evaluates the later ones in order", () => {
    const base = [1, 2, 3, 4].map((n) => ({ n, sa: 2, sb: 0, at: `2026-11-14 1${n}:00` }));
    // match 1 is changed to a loss: the day total is then 1.2 - 1.2 + 1.2 + 1.2 = 2.4 (not capped)
    const out = sql(`${world({ matches: base })} ${[1, 2, 3, 4].map(sync).join("\n")} update public.tournament_matches set score_a = 0, score_b = 2 where id = '${match(1)}'; ${[1, 2, 3, 4].map(sync).join("\n")} ${ratingsOf([captain(0)])}`);
    const fresh = sql(`${world({ matches: [{ n: 1, sa: 0, sb: 2, at: "2026-11-14 11:00" }, ...base.slice(1)] })} ${[1, 2, 3, 4].map(sync).join("\n")} ${ratingsOf([captain(0)])}`);
    expect(ratingMap(out).get(captain(0))).toEqual(ratingMap(fresh).get(captain(0)));
    expect(ratingMap(out).get(captain(0))!.score).toBe(52.4);
  });

  it("8c. clearing a score, or removing a match, takes its effect back out", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }, { n: 2, sa: 1, sb: 0, at: "2026-11-14 17:00" }] };
    const out = sql(`${world(w)} ${sync(1)} ${sync(2)}
      update public.tournament_matches set score_a = null, score_b = null, winner_id = null, completed_at = null where id = '${match(1)}';
      ${sync(1)} select 'after-reset|' || (select count(*) from public.pickup_runs);
      select 'forget|' || public.tournament_forget_matches(array['${match(2)}']::uuid[]);
      ${ratingsOf(players(w))} select 'runs|' || count(*) from public.pickup_runs; select 'adj|' || count(*) from public.rating_result_adjustments;
      select 'attendance|' || count(*) from public.session_attendance; select 'events|' || count(*) from public.rating_events;`);
    expect(find(out, "after-reset|")).toBe("after-reset|1");
    for (const r of ratingMap(out).values()) expect(r.score).toBe(50);
    expect(find(out, "runs|")).toBe("runs|0");
    expect(find(out, "attendance|")).toBe("attendance|0");
    expect(find(out, "events|")).toBe("events|0");
  });

  it("8d. unrating a whole tournament puts every rating back and leaves nothing behind", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }, { n: 2, sa: 0, sb: 1, at: "2026-11-15 12:00" }] };
    const out = sql(`${world(w)} ${sync(1)} ${sync(2)} select 'unrate|' || public.tournament_unrate_tournament('${TOUR}'); ${ratingsOf(players(w))}
      select 'left|' || (select count(*) from public.pickup_runs) || (select count(*) from public.tier_sessions where venue = 'Tournament day') || (select count(*) from public.tournament_rating_days) || (select count(*) from public.rating_events);`);
    for (const r of ratingMap(out).values()) expect(r.score).toBe(50);
    expect(find(out, "left|")).toBe("left|0000");
  });

  it("1c. if a tournament is switched to not rated behind the app's back, its matches stop counting and the ratings go back", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)} ${rating(captain(0))}
      update public.tournaments set rated = false;
      select 'moved|' || public.apply_result_rating((select run_id from public.tournament_match_runs limit 1));
      ${rating(captain(0))} ${rating(captain(1))}
      select 'why|' || reason from public.tournament_match_rating;`);
    const r = out.filter((l) => l.startsWith("r|captain") || l.startsWith("r|"));
    expect(r.map((l) => Number(l.split("|")[2]))).toEqual([51.2, 50, 50]);
    expect(find(out, "why|")).toBe("why|not_rated");
  });

  it("6. only players on a team in a scored match get attendance; nobody is marked absent; reliability and sessions never change", () => {
    const w: W = { invited: true, matches: [{ n: 1, sa: 3, sb: 1 }, { n: 2, a: 0, b: 1, at: null }] };
    const out = sql(`${world(w)} ${sync(1)} ${sync(2)} ${ratingsOf([...players(w), BYSTANDER])}
      select 'att|' || user_id || '|' || status from public.session_attendance order by user_id;
      select 'noshow|' || count(*) from public.session_attendance where status <> 'attended';
      select 'bystander|' || count(*) from public.session_attendance where user_id = '${BYSTANDER}' union all select 'bystander-events|' || count(*) from public.rating_events where user_id = '${BYSTANDER}';`);
    const att = out.filter((l) => l.startsWith("att|"));
    expect(att.map((l) => l.split("|")[1]).sort()).toEqual([...players(w)].sort());
    expect(find(out, "noshow|")).toBe("noshow|0");
    expect(out.filter((l) => l.startsWith("bystander")).map((l) => l.split("|")[1])).toEqual(["0", "0"]);
    const r = ratingMap(out);
    for (const [, v] of r) { expect(v.reliability).toBe(92); expect(v.sessions).toBe(0); }
    expect(r.get(BYSTANDER)!.score).toBe(50);
  });

  it("6b. a player named on both teams plays for neither, and an unscored match writes nothing", () => {
    const both = rostered(1, 0);
    const w: W = { matches: [{ n: 1, sa: 2, sb: 0 }, { n: 2, a: 0, b: 1, at: null }] };
    const out = sql(`${world(w)} insert into public.tournament_roster (captain_id, user_id, status) values ('${team(0)}', '${both}', 'accepted');
      ${sync(1)} ${sync(2)} select 'ass|' || count(*) from public.pickup_run_team_assignments where user_id = '${both}'; select 'runs|' || count(*) from public.pickup_runs;`);
    expect(find(out, "ass|")).toBe("ass|0");
    expect(find(out, "runs|")).toBe("runs|1");
    expect(sync_json(out, 2)).toMatchObject({ counted: false, reason: "not_scored" });
  });

  it("7. the results-entered cap neither blocks a tournament match nor is used up by one", () => {
    // 9 earlier verified results by the same admin involving player A0 would put a normal game past the cap of 6.
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const earlier = Array.from({ length: 9 }, (_, i) => `
      insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8100 + i)}', 'old', 'completed', now() - interval '3 days', '${ADMIN}');
      insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, created_at) values ('${uuid(8100 + i)}', 2, 'A', '${ADMIN}', now() - interval '${i + 1} hours');
      insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8100 + i)}', '${captain(0)}', 'A');`).join("\n");
    const out = sql(`${world(w)} ${earlier} ${sync(1)} ${ratingsOf([captain(0)])}`);
    expect(ratingMap(out).get(captain(0))!.score).toBe(51.2); // counted, although the poster cap would have ignored a normal game

    // and tournament matches are not counted by the cap for a normal game: 6 tournament matches posted by the admin, then one ordinary
    // verified game posted by the same admin with the same player. The cap is 6, so counting the tournament matches (7 in all) would
    // ignore the ordinary game; not counting them (1) lets it move the player.
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ n, sa: 1, sb: 0, at: `2026-11-1${n} 15:00` }));
    const out2 = sql(`${world({ matches: six })} ${six.map((m) => sync(m.n)).join("\n")}
      select 'tournament-runs|' || count(*) from public.tournament_match_runs;
      ${ordinaryGame()}
      select 'moved|' || public.apply_result_rating('${uuid(8200)}');
      select 'normal-adj|' || count(*) from public.rating_result_adjustments where run_id = '${uuid(8200)}' and delta <> 0;`);
    expect(find(out2, "tournament-runs|")).toBe("tournament-runs|6");
    expect(find(out2, "normal-adj|")).toBe("normal-adj|10");
  });

  it("9. an admin score counts as verified without any captain confirmation; a normal unverified result still counts for nothing", () => {
    const w: W = { matches: [{ n: 1, sa: 2, sb: 0 }] };
    const out = sql(`${world(w)} ${sync(1)}
      select 'verified|' || (verified_at is not null) from public.pickup_run_results;
      select 'confirmations|' || count(*) from public.pickup_run_result_confirmations;
      select 'adj-before|' || count(*) from public.rating_result_adjustments where delta <> 0;
      update public.pickup_run_results set verified_at = null;
      select 'moved|' || public.apply_result_rating((select run_id from public.pickup_run_results limit 1));
      select 'adj-after|' || count(*) from public.rating_result_adjustments where delta <> 0;`);
    expect(find(out, "verified|")).toBe("verified|true");
    expect(find(out, "confirmations|")).toBe("confirmations|0");
    expect(find(out, "adj-before|")).toBe("adj-before|10");
    expect(find(out, "adj-after|")).toBe("adj-after|10"); // still counted: verified is not required of a tournament match

    // a normal (non tournament) game with an unverified result moves nothing
    const out2 = sql(`${world({ matches: [] })}
      insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8200)}', 'g', 'completed', now() - interval '2 hours', '${ADMIN}');
      insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${uuid(8201)}', '${ADMIN}', 'v', now() - interval '2 hours', 20, 'settled');
      update public.pickup_runs set tier_session_id = '${uuid(8201)}' where id = '${uuid(8200)}';
      ${players({ sizes: [5, 5] }).map((p, i) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, peer_weight, k_factor, delta, score_before, score_after) values ('${uuid(8201)}', '${p}', 0, 0, 0, 16, 0, 50, 50);
        insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8200)}', '${p}', '${i < 5 ? "A" : "B"}');`).join("\n")}
      insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by) values ('${uuid(8200)}', 2, 'A', '${ADMIN}');
      select 'moved|' || public.apply_result_rating('${uuid(8200)}');
      update public.pickup_run_results set verified_at = now() where run_id = '${uuid(8200)}';
      select 'moved-verified|' || public.apply_result_rating('${uuid(8200)}');`);
    expect(find(out2, "moved|")).toBe("moved|0");
    expect(find(out2, "moved-verified|")).toBe("moved-verified|10");
  });

  it("9b. a penalty winner is the winner, stored with no score; a level group match is a draw; a bye and an unscored match count for nothing", () => {
    const w: W = { matches: [{ n: 1, sa: 1, sb: 1, winner: 1 }, { n: 2, sa: 2, sb: 2, winner: null, at: "2026-11-15 12:00" }, { n: 3, bye: true, at: "2026-11-16 12:00" }, { n: 4, at: null }] };
    const out = sql(`${world(w)} ${[1, 2, 3, 4].map(sync).join("\n")}
      select 'res|' || coalesce(winning_team, 'none') || '|' || coalesce(score_a::text, 'null') || '|' || coalesce(score_b::text, 'null') from public.pickup_run_results r join public.tournament_match_runs l on l.run_id = r.run_id order by l.match_id;
      ${ratingsOf([captain(0), captain(1)])} select 'runs|' || count(*) from public.pickup_runs;`);
    const res = out.filter((l) => l.startsWith("res|"));
    expect(res).toEqual(["res|B|null|null", "res|none|2|2"]); // penalty winner B with no score; the draw keeps its level score
    const r = ratingMap(out);
    // day 1: the penalty winner gains 1.2 and the loser loses 1.2. Day 2 is a draw: the team that was ahead going in is expected to
    // win, so a draw costs it a little (0.12) and gives the other team the same. A draw moves nobody by a full win.
    expect(r.get(captain(1))!.score).toBe(51.08);
    expect(r.get(captain(0))!.score).toBe(48.92);
    expect(find(out, "runs|")).toBe("runs|2");
    expect(sync_json(out, 3)).toMatchObject({ counted: false });
    expect(sync_json(out, 4)).toMatchObject({ counted: false, reason: "not_scored" });
  });

  it("10. the existing team rule applies per match: 1 v 1 and 3 v 3 are too few, 4 v 4 is the minimum, 5 v 7 is uneven, 5 v 6 is fine", () => {
    const cases: Array<[number[], boolean, string | null]> = [
      [[1, 1], false, "too_few_players"],
      [[3, 3], false, "too_few_players"],
      [[4, 4], true, null],
      [[5, 6], true, null],
      [[5, 7], false, "teams_uneven"],
      [[8, 5], false, "teams_uneven"],
    ];
    for (const [sizes, counted, reason] of cases) {
      const w: W = { sizes, matches: [{ n: 1, sa: 2, sb: 0 }] };
      const out = sql(`${world(w)} ${sync(1)} ${rating(captain(0))}`);
      const j = sync_json(out, 1);
      expect([sizes, j.counted, j.reason]).toEqual([sizes, counted, reason]);
      expect(ratingMap(out).get(captain(0))!.score !== 50).toBe(counted);
    }
  });

  it("10b. the minimum is about the players of the match, not the whole day: two 3 v 3 matches on one day are both too small", () => {
    const w: W = { sizes: [3, 3, 3, 3], matches: [{ n: 1, a: 0, b: 1, sa: 2, sb: 0 }, { n: 2, a: 2, b: 3, sa: 1, sb: 0, at: "2026-11-14 16:00" }] };
    const out = sql(`${world(w)} ${sync(1)} ${sync(2)} select 'day|' || count(*) from public.rating_events;`);
    expect(find(out, "day|")).toBe("day|12"); // 12 players that day, more than the minimum of 8
    expect(sync_json(out, 1)).toMatchObject({ counted: false, reason: "too_few_players" });
    expect(sync_json(out, 2)).toMatchObject({ counted: false, reason: "too_few_players" });
  });

  it("3c. a player cannot be moved by a tournament past the rating scale", () => {
    const w: W = { score: 99.9, matches: [{ n: 1, sa: 3, sb: 0 }] };
    const out = sql(`${world(w)} ${sync(1)} ${rating(captain(0))}`);
    expect(ratingMap(out).get(captain(0))!.score).toBeLessThanOrEqual(100);
  });

  it("5. a rated tournament that does not count for the season writes no season points rows from SQL; count_for_season alone makes a record without ratings", () => {
    const w: W = { rated: false, season: true, matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)} ${ratingsOf([captain(0)])}
      select 'runs|' || count(*) from public.pickup_runs; select 'days|' || count(*) from public.tournament_rating_days; select 'points|' || count(*) from public.points_events;`);
    expect(sync_json(out, 1)).toMatchObject({ status: "recorded", counted: false, reason: "not_rated" });
    expect(find(out, "runs|")).toBe("runs|1");
    expect(find(out, "days|")).toBe("days|0");
    expect(find(out, "points|")).toBe("points|0");
    expect(ratingMap(out).get(captain(0))!.score).toBe(50);
  });

  it("12. the client sees none of it: a signed in player reads no tournament match record, result, team list or link", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)}
      insert into public.pickup_runs (id, title, status, start_at) values ('${uuid(8300)}', 'real game', 'open', now());
      insert into public.pickup_run_results (run_id, total_teams, winning_team) values ('${uuid(8300)}', 2, 'A');
      insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8300)}', '${captain(0)}', 'A');
      alter table public.pickup_runs enable row level security; alter table public.pickup_run_results enable row level security; alter table public.pickup_run_team_assignments enable row level security;
      create policy t_all on public.pickup_runs for select using (true); create policy t_all on public.pickup_run_results for select using (true); create policy t_all on public.pickup_run_team_assignments for select using (true);
      grant select on public.pickup_runs, public.pickup_run_results, public.pickup_run_team_assignments to authenticated, anon;
      set local role authenticated;
      select 'runs|' || count(*) from public.pickup_runs;
      select 'results|' || count(*) from public.pickup_run_results;
      select 'assign|' || count(*) from public.pickup_run_team_assignments;
      reset role;
      select 'server-runs|' || count(*) from public.pickup_runs;`);
    expect(find(out, "runs|")).toBe("runs|1");
    expect(find(out, "results|")).toBe("results|1");
    expect(find(out, "assign|")).toBe("assign|1");
    expect(find(out, "server-runs|")).toBe("server-runs|2");
    // the link table stays closed to clients
    const err = sqlError(`${world(w)} ${sync(1)} set local role authenticated; select count(*) from public.tournament_match_runs;`);
    expect(err).toMatch(/permission denied/);
  });

  it("12b. nothing the function returns, or stores for the admin, holds a rating", () => {
    const w: W = { matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} ${sync(1)} select 'cols|' || string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'tournament_match_rating';`);
    expect(Object.keys(sync_json(out, 1)).sort()).toEqual(["counted", "players", "reason", "status"]);
    expect(find(out, "cols|")).toBe("cols|match_id,run_id,counted,reason,updated_at");
  });

  it("the replaced apply_result_rating gives every ordinary game the same answer as before", () => {
    // A normal game, verified: the same numbers the original function produced (see ratingResults.sql.test.ts for the full set).
    const out = sql(`${world({ matches: [] })}
      insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8200)}', 'g', 'completed', now() - interval '2 hours', '${ADMIN}');
      insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${uuid(8201)}', '${ADMIN}', 'v', now() - interval '2 hours', 20, 'settled');
      update public.pickup_runs set tier_session_id = '${uuid(8201)}' where id = '${uuid(8200)}';
      ${players({ sizes: [5, 5] }).map((p, i) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, peer_weight, k_factor, delta, score_before, score_after) values ('${uuid(8201)}', '${p}', 0, 0, 0, 16, 0, 50, 50);
        insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8200)}', '${p}', '${i < 5 ? "A" : "B"}');`).join("\n")}
      insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, verified_at) values ('${uuid(8200)}', 2, 'A', '${ADMIN}', now());
      select 'moved|' || public.apply_result_rating('${uuid(8200)}');
      ${ratingsOf([captain(0), captain(1)])}`);
    expect(find(out, "moved|")).toBe("moved|10");
    expect(ratingMap(out).get(captain(0))!.score).toBe(51.2);
    expect(ratingMap(out).get(captain(1))!.score).toBe(48.8);
  });
});
