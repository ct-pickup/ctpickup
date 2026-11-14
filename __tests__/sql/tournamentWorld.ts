import { uuid } from "./harness";

/** Shared fixtures for the rated tournament SQL tests: a tournament with teams, rated players, matches and the rating switches. */
export const ADMIN = uuid(5000);
export const TOUR = uuid(5001);
export const BYSTANDER = uuid(5002);
export const team = (t: number) => uuid(5200 + t);
export const captain = (t: number) => uuid(6000 + t * 100);
export const rostered = (t: number, i: number) => uuid(6000 + t * 100 + i + 1);
export const match = (n: number) => uuid(7000 + n);

export type M = {
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
export type W = {
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

export function players(w: W): string[] {
  const sizes = w.sizes ?? [5, 5];
  const out: string[] = [];
  sizes.forEach((size, t) => {
    out.push(captain(t));
    for (let i = 0; i < size - 1; i++) out.push(rostered(t, i));
  });
  return out;
}

/** A tournament with teams, rated players and matches. The matches are inserted already scored (that is what the admin route leaves behind). */
export function world(w: W = {}): string {
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

export const sync = (n: number) => `select 'sync${n}|' || public.tournament_sync_match('${match(n)}', '${ADMIN}')::text;`;
export const rating = (u: string) => `select 'r|${u}|' || score || '|' || reliability || '|' || sessions from public.player_ratings where user_id = '${u}';`;
export const ratingsOf = (us: string[]) => us.map(rating).join("\n");

export const find = (xs: string[], prefix: string) => xs.find((l) => l.startsWith(prefix));
export const sync_json = (xs: string[], n: number) => JSON.parse(find(xs, `sync${n}|`)!.slice(`sync${n}|`.length)) as { status: string; counted: boolean; reason: string | null };
export const ratingMap = (xs: string[]) => new Map(xs.filter((l) => l.startsWith("r|")).map((l) => { const [, u, s, rel, ses] = l.split("|"); return [u!, { score: Number(s), reliability: Number(rel), sessions: Number(ses) }] as const; }));

/** An ordinary (not tournament) settled, verified game posted by the admin with the same ten players, teams A and B. */
export const ordinaryGame = () => `
  insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8200)}', 'g', 'completed', now() - interval '2 hours', '${ADMIN}');
  insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${uuid(8201)}', '${ADMIN}', 'v', now() - interval '2 hours', 20, 'settled');
  update public.pickup_runs set tier_session_id = '${uuid(8201)}' where id = '${uuid(8200)}';
  ${players({ sizes: [5, 5] }).map((p, i) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, peer_weight, k_factor, delta, score_before, score_after) values ('${uuid(8201)}', '${p}', 0, 0, 0, 16, 0, 50, 50);
    insert into public.pickup_run_team_assignments (run_id, user_id, team) values ('${uuid(8200)}', '${p}', '${i < 5 ? "A" : "B"}');`).join("\n")}
  insert into public.pickup_run_results (run_id, total_teams, winning_team, created_by, verified_at) values ('${uuid(8200)}', 2, 'A', '${ADMIN}', now());`;

export const A = (w: W = {}) => players({ sizes: w.sizes ?? [5, 5] }).slice(0, (w.sizes ?? [5, 5])[0]!);
export const B = (w: W = {}) => players({ sizes: w.sizes ?? [5, 5] }).slice((w.sizes ?? [5, 5])[0]!);

