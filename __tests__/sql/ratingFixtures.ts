import { DEFAULT_CONFIG, K_BASE, ORG_FLOOR, settleV1, settleV2Base, type Attendee, type Session, type Vote } from "../../lib/rating/ratingMath";
import { uuid } from "./harness";

/** A small game with history, written as SQL and as the TypeScript twin's input, so the two can be compared. */
export const ORG = uuid(900);
export const ORG0 = uuid(901); // an earlier host
export const SESSION = uuid(700);
export const SESSION_OLD = uuid(701);

export type Fx = { id: string; score: number; sessions: number; reliability: number; os: number };
export const PLAYERS: Fx[] = [
  { id: uuid(801), score: 82, sessions: 12, reliability: 95, os: 9 },
  { id: uuid(802), score: 60, sessions: 6, reliability: 90, os: 7 },
  { id: uuid(803), score: 35, sessions: 3, reliability: 80, os: 3 },
  { id: uuid(804), score: 50, sessions: 0, reliability: 92, os: 5 },
  { id: uuid(805), score: 70, sessions: 20, reliability: 99, os: 6 },
  { id: uuid(806), score: 45, sessions: 1, reliability: 60, os: 4 },
  { id: uuid(807), score: 55, sessions: 9, reliability: 92, os: 8 },
  { id: uuid(808), score: 40, sessions: 15, reliability: 88, os: 2 },
];
const ids = PLAYERS.map((p) => p.id);
// voter -> three picks. 801 and 802 voted for 803 earlier too (see OLD_VOTES).
export const VOTES: [string, string[]][] = [
  [ids[0]!, [ids[4]!, ids[1]!, ids[6]!]],
  [ids[1]!, [ids[0]!, ids[2]!, ids[4]!]],
  [ids[2]!, [ids[0]!, ids[4]!, ids[1]!]],
  [ids[3]!, [ids[0]!, ids[1]!, ids[4]!]],
  [ids[4]!, [ids[0]!, ids[6]!, ids[1]!]],
  [ids[5]!, [ids[0]!, ids[2]!, ids[4]!]],
  [ids[6]!, [ids[0]!, ids[1]!, ids[7]!]],
];
// An earlier settled game, 10 days before, under the same host ORG for 801, 802, 804 and under ORG0 for the rest.
export const OLD_ATTENDEES = { sameHost: [ids[0]!, ids[1]!, ids[3]!], otherHost: [ids[2]!, ids[4]!, ids[5]!, ids[6]!] };
export const OLD_VOTES: [string, string][] = [[ids[1]!, ids[0]!], [ids[2]!, ids[0]!]];

export function fixtureSql(): string {
  const users = [...ids, ORG, ORG0].map((id) => `('${id}')`).join(",");
  const ratings = PLAYERS.map((p) => `('${p.id}', ${p.score}, ${p.sessions}, ${p.reliability})`).join(",");
  const attendance = PLAYERS.map((p) => `('${SESSION}', '${p.id}', 'attended', ${p.os})`).join(",");
  const votes = VOTES.flatMap(([voter, picks]) => picks.map((v, i) => `('${SESSION}', '${voter}', '${v}', ${i + 1})`)).join(",");
  const oldAtt = OLD_ATTENDEES.sameHost.map((id) => `('${SESSION_OLD}', '${id}', 'attended', 5)`).join(",");
  const oldVotes = OLD_VOTES.map(([voter, votee], i) => `('${SESSION_OLD}', '${voter}', '${votee}', ${i + 1})`).join(",");
  // The old game is attended under ORG by sameHost and rated; the other players' history is a different old game under ORG0.
  const oldOther = uuid(702);
  const oldOtherAtt = OLD_ATTENDEES.otherHost.map((id) => `('${oldOther}', '${id}', 'attended', 5)`).join(",");
  const events = (sid: string, list: string[]) => list.map((id) => `('${sid}', '${id}', 0, 1, 5, 0.5, 16, 0, 50, 50)`).join(",");
  return `
    do $$ begin if to_regprocedure('auth.role()') is null then
      create function auth.role() returns text language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), ''service_role'')';
    end if; end $$;
    insert into auth.users (id) values ${users};
    insert into public.player_ratings (user_id, score, sessions, reliability) values ${ratings};
    insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state, settled_at) values
      ('${SESSION_OLD}', '${ORG}', 'old', now() - interval '10 days', 20, 'settled', now() - interval '9 days'),
      ('${oldOther}', '${ORG0}', 'old0', now() - interval '12 days', 20, 'settled', now() - interval '11 days');
    insert into public.session_attendance (session_id, user_id, status, organizer_score) values ${oldAtt};
    insert into public.session_attendance (session_id, user_id, status, organizer_score) values ${oldOtherAtt};
    insert into public.peer_votes (session_id, voter_id, votee_id, rank) values ${oldVotes};
    insert into public.rating_events (session_id, user_id, votes_received, votes_expected, organizer_score, peer_weight, k_factor, delta, score_before, score_after) values
      ${events(SESSION_OLD, OLD_ATTENDEES.sameHost)}, ${events(oldOther, OLD_ATTENDEES.otherHost)};
    insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${SESSION}', '${ORG}', 'now', now() - interval '1 hour', 20, 'open');
    insert into public.session_attendance (session_id, user_id, status, organizer_score) values ${attendance};
    insert into public.peer_votes (session_id, voter_id, votee_id, rank) values ${votes};
  `;
}

/** What the TypeScript twin says for the same game. */
export function expectedV2(over: Partial<typeof DEFAULT_CONFIG> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...over };
  const sameHost = new Set(OLD_ATTENDEES.sameHost);
  const attendees: Attendee[] = PLAYERS.map((p) => {
    const old = [...OLD_ATTENDEES.sameHost, ...OLD_ATTENDEES.otherHost].includes(p.id);
    const hosts = new Set<string>();
    const voters = new Set<string>();
    if (old) hosts.add(sameHost.has(p.id) ? ORG : ORG0);
    for (const [voter, votee] of OLD_VOTES) if (votee === p.id) voters.add(voter);
    return {
      id: p.id, score: p.score, sessions: p.sessions, reliability: p.reliability, organizerScore: p.os,
      hostPriorGames: sameHost.has(p.id) ? 1 : 0,
      prior: { hosts, voters, games: old ? 1 : 0 },
    };
  });
  const votes: Vote[] = VOTES.flatMap(([voter, picks]) => picks.map((votee) => ({
    voter, votee, priorPairGames: OLD_VOTES.filter(([a, b]) => a === voter && b === votee).length,
  })));
  const session: Session = {
    organizerId: ORG, attendees, votes,
    voters: Object.fromEntries(PLAYERS.map((p) => [p.id, { score: p.score, sessions: p.sessions, reliability: p.reliability }])),
  };
  return settleV2Base(session, cfg, K_BASE, ORG_FLOOR);
}

/** What today's formula gives for the same game (history does not matter to it). */
export function expectedV1() {
  const attendees: Attendee[] = PLAYERS.map((p) => ({ id: p.id, score: p.score, sessions: p.sessions, reliability: p.reliability, organizerScore: p.os }));
  const votes: Vote[] = VOTES.flatMap(([voter, picks]) => picks.map((votee) => ({ voter, votee })));
  return settleV1({ organizerId: ORG, attendees, votes }, K_BASE, ORG_FLOOR);
}
