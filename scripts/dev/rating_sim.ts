/**
 * Rating simulator. No database, no network. Run:   node scripts/dev/rating_sim.ts [--quick] [--out docs/rating-v2-simulation.md]
 *
 * Players have a hidden true skill T (0..100, the same scale as the rating). Everyone starts at 50. Hosts judge a player as
 * 1 + 9*T/100 plus noise, voters pick the three best others by T plus noise, teams are random splits and the result follows the
 * true team averages. The engines are the exact formulas in lib/rating/ratingMath.ts, which mirror settle_session (v1) and
 * settle_session_v2:
 *   v1   today's formula
 *   v2   field strength, weighted votes, host limits, collusion damping, distinct evidence
 *   v2r  v2 plus the result signal (rating_results)
 *   v2a  v2 with org_anchor 1 (host score read against the player's own score, so ratings settle where the host sees the player)
 * Everything is seeded: the same command gives the same numbers.
 */
import { writeFileSync } from "node:fs";
import {
  DEFAULT_CONFIG, settleV1, settleV2, type Attendee, type RatingConfig, type Session, type Vote,
} from "../../lib/rating/ratingMath.ts";

type Engine = "v1" | "v2" | "v2r" | "v2a";
const ENGINES: Engine[] = ["v1", "v2", "v2r", "v2a"];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number { return Math.sqrt(-2 * Math.log(this.next() + 1e-12)) * Math.cos(2 * Math.PI * this.next()); }
  shuffle<X>(xs: X[]): X[] { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; }
  sample<X>(xs: X[], n: number): X[] { return this.shuffle(xs).slice(0, n); }
}

type P = { id: string; T: number; score: number; sessions: number; reliability: number; games: number };
type Prior = { hosts: Set<string>; voters: Set<string>; games: number };

type Opts = { engine: Engine; noShow: number; turnout: number; cfg?: RatingConfig };
type World = {
  rng: Rng; opts: Opts; cfg: RatingConfig; players: P[]; byId: Map<string, P>; day: number;
  voteHist: Map<string, number[]>; hostHist: Map<string, number[]>; resHist: Map<string, number[]>; prior: Map<string, Prior>;
  hosts: string[];
};

const cfgFor = (e: Engine): RatingConfig => (e === "v2a" ? { ...DEFAULT_CONFIG, org_anchor: 1 } : DEFAULT_CONFIG);

function newWorld(seed: number, opts: Opts, n = 120): World {
  const rng = new Rng(seed);
  const players: P[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, T: clamp(50 + 15 * rng.normal(), 5, 95), score: 50, sessions: 0, reliability: 92, games: 0 }));
  const w: World = { rng, opts, cfg: opts.cfg ?? cfgFor(opts.engine), players, byId: new Map(players.map((p) => [p.id, p])), day: 0, voteHist: new Map(), hostHist: new Map(), resHist: new Map(), prior: new Map(), hosts: Array.from({ length: 10 }, (_, i) => `h${i}`) };
  return w;
}
function addPlayer(w: World, id: string, T: number): P {
  const p: P = { id, T, score: 50, sessions: 0, reliability: 92, games: 0 };
  w.players.push(p); w.byId.set(id, p);
  return p;
}

const within = (days: number[] | undefined, now: number, span: number) => (days ?? []).filter((d) => d >= now - span && d < now).length;

type Collusion = { friendlyHost?: Set<string>; ring?: { members: Set<string>; target: string } };

/** One game: roster shows up (or not), splits into teams, host scores, players vote, the engine settles, history updates. */
function playGame(w: World, roster: P[], hostId: string, col: Collusion = {}): { attended: number } {
  const { rng, opts } = w;
  const showed = roster.filter(() => rng.next() >= opts.noShow);
  for (const p of roster) if (!showed.includes(p)) p.reliability = clamp(p.reliability - 7, 0, 100);
  if (showed.length < 4) return { attended: 0 };
  const shuffled = rng.shuffle(showed);
  const A = shuffled.filter((_, i) => i % 2 === 0);
  const B = shuffled.filter((_, i) => i % 2 === 1);
  const avg = (xs: P[]) => xs.reduce((t, x) => t + x.T, 0) / xs.length;
  const pA = 1 / (1 + Math.exp(-(avg(A) - avg(B)) / 15));
  const r = rng.next();
  const winner: "A" | "B" | null = r < 0.08 ? null : rng.next() < pA ? "A" : "B";

  const judge = (p: P) => (col.friendlyHost?.has(hostId) && w.byId.get(p.id) && friendsOf(col, p.id) ? 10 : clamp(Math.round(1 + (9 * p.T) / 100 + 1.2 * rng.normal()), 1, 10));
  const votes: Vote[] = [];
  for (const voter of showed) {
    if (rng.next() >= opts.turnout) continue;
    const others = showed.filter((x) => x.id !== voter.id);
    const ring = col.ring;
    const ringVoter = ring?.members.has(voter.id) && others.some((o) => o.id === ring.target);
    let picks: string[] = [];
    if (ringVoter && ring) picks.push(ring.target);
    const ranked = others.filter((o) => !picks.includes(o.id)).map((o) => ({ id: o.id, v: o.T + 8 * rng.normal() })).sort((a, b) => b.v - a.v);
    picks = [...picks, ...ranked.map((x) => x.id)].slice(0, 3);
    picks.forEach((votee) => votes.push({ voter: voter.id, votee }));
  }
  for (const v of votes) v.priorPairGames = within(w.voteHist.get(`${v.voter}>${v.votee}`), w.day, w.cfg.pair_window_days);

  const priorOf = (id: string) => w.prior.get(id) ?? { hosts: new Set<string>(), voters: new Set<string>(), games: 0 };
  const attendees: Attendee[] = showed.map((p) => ({
    id: p.id, score: p.score, sessions: p.sessions, reliability: p.reliability, organizerScore: judge(p),
    hostPriorGames: within(w.hostHist.get(`${hostId}|${p.id}`), w.day, w.cfg.host_pair_days), prior: priorOf(p.id),
  }));
  const teams: Record<string, "A" | "B"> = {};
  A.forEach((p) => (teams[p.id] = "A")); B.forEach((p) => (teams[p.id] = "B"));
  const hostResultCount: Record<string, number> = {};
  for (const p of showed) hostResultCount[p.id] = within(w.resHist.get(`${hostId}|${p.id}`), w.day, 30) + 1;
  const session: Session = {
    organizerId: hostId, attendees, votes,
    voters: Object.fromEntries(showed.map((p) => [p.id, { score: p.score, sessions: p.sessions, reliability: p.reliability }])),
    result: { teams, winningTeam: winner, verified: true, hostResultCount },
  };
  const out = opts.engine === "v1" ? settleV1(session) : settleV2(session, w.cfg, opts.engine === "v2r");
  for (const o of out) {
    const p = w.byId.get(o.id)!;
    p.score = o.scoreAfter; p.sessions += 1; p.games += 1; p.reliability = clamp(p.reliability + 1, 0, 100);
    const pr = w.prior.get(p.id) ?? { hosts: new Set<string>(), voters: new Set<string>(), games: 0 };
    if (hostId !== p.id) pr.hosts.add(hostId);
    for (const v of votes) if (v.votee === p.id) pr.voters.add(v.voter);
    pr.games += 1; w.prior.set(p.id, pr);
    const hk = `${hostId}|${p.id}`; w.hostHist.set(hk, [...(w.hostHist.get(hk) ?? []), w.day]);
    w.resHist.set(hk, [...(w.resHist.get(hk) ?? []), w.day]);
  }
  for (const v of votes) { const k = `${v.voter}>${v.votee}`; w.voteHist.set(k, [...(w.voteHist.get(k) ?? []), w.day]); }
  return { attended: showed.length };
}
const friendsOf = (_c: Collusion, _id: string) => _id.startsWith("smurf") || _id.startsWith("friend");

/** One week of ordinary games for everyone not in `exclude`: half the players are sorted into strong/weak fields, half are mixed. */
function leagueWeek(w: World, exclude: Set<string>) {
  const { rng } = w;
  const pool = w.players.filter((p) => !exclude.has(p.id));
  const sortedCount = Math.floor(pool.length / 2);
  const shuffled = rng.shuffle(pool);
  const sorted = shuffled.slice(0, sortedCount).map((p) => ({ p, k: p.T + 5 * rng.normal() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const mixed = shuffled.slice(sortedCount);
  const chunks = (xs: P[]) => { const out: P[][] = []; for (let i = 0; i < xs.length; i += 12) out.push(xs.slice(i, i + 12)); return out; };
  for (const roster of [...chunks(sorted), ...chunks(mixed)]) {
    if (roster.length < 6) continue;
    playGame(w, roster, rng.sample(w.hosts, 1)[0]!);
  }
}

const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(xs.length, 1);
function rmse(w: World, ids?: Set<string>) {
  const ps = w.players.filter((p) => !ids || ids.has(p.id));
  return Math.sqrt(mean(ps.map((p) => (p.score - p.T) ** 2)));
}
function spearman(w: World, ids?: Set<string>) {
  const ps = w.players.filter((p) => !ids || ids.has(p.id));
  const rank = (xs: number[]) => { const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length).fill(0); idx.forEach(([, i], pos) => (r[i] = pos)); return r as number[]; };
  const a = rank(ps.map((p) => p.score)), b = rank(ps.map((p) => p.T));
  const ma = mean(a), mb = mean(b);
  const num = a.reduce((t, x, i) => t + (x - ma) * (b[i]! - mb), 0);
  return num / Math.sqrt(a.reduce((t, x) => t + (x - ma) ** 2, 0) * b.reduce((t, x) => t + (x - mb) ** 2, 0));
}

type Series = number[]; // subject score after each of their games
const firstReach = (s: Series, x: number) => { const i = s.findIndex((v) => v >= x); return i < 0 ? null : i + 1; };
const at = (s: Series, n: number) => (s.length >= n ? s[n - 1]! : s[s.length - 1] ?? NaN);

type Subject = "smurf_friendly_host" | "smurf_host_and_voters" | "honest_strong_mixed" | "friend_host_only" | "friend_voters_only" | "friend_host_and_voters" | "honest_weak_control";

/** A subject joins a league that has already played 40 weeks. Returns the subject's score after each of their games. */
function runSubject(seed: number, engine: Engine, subject: Subject, weeks = 52, noShow = 0.08, cfg?: RatingConfig): Series {
  const w = newWorld(seed, { engine, noShow, turnout: 0.85, cfg });
  for (let wk = 0; wk < 40; wk++) { w.day = wk * 7; leagueWeek(w, new Set()); }
  const strong = subject.startsWith("smurf") || subject === "honest_strong_mixed";
  const me = addPlayer(w, strong ? `smurf-${subject}` : `friend-${subject}`, strong ? 85 : 30);
  const ring = subject.endsWith("voters") || subject.endsWith("host_and_voters") || subject === "smurf_host_and_voters";
  const hostCol = subject === "smurf_friendly_host" || subject === "smurf_host_and_voters" || subject === "friend_host_only" || subject === "friend_host_and_voters";
  const mates = ring ? [addPlayer(w, "friend-a", 35), addPlayer(w, "friend-b", 35), addPlayer(w, "friend-c", 35)] : [];
  const exclude = new Set([me.id, ...mates.map((m) => m.id)]);
  const series: Series = [];
  const weakPool = w.players.filter((p) => p.T < 40 && !exclude.has(p.id));
  for (let wk = 40; wk < 40 + weeks; wk++) {
    w.day = wk * 7;
    leagueWeek(w, exclude);
    let roster: P[];
    let host: string;
    if (subject === "honest_strong_mixed" || subject === "honest_weak_control") {
      roster = [me, ...w.rng.sample(w.players.filter((p) => !exclude.has(p.id)), 11)];
      host = w.rng.sample(w.hosts, 1)[0]!;
    } else if (subject.startsWith("smurf")) {
      roster = [me, ...mates, ...w.rng.sample(weakPool, 11 - mates.length)];
      host = hostCol ? "h-friend" : w.rng.sample(w.hosts, 1)[0]!;
    } else {
      roster = [me, ...mates, ...w.rng.sample(w.players.filter((p) => !exclude.has(p.id)), 11 - mates.length)];
      host = hostCol ? "h-friend" : w.rng.sample(w.hosts, 1)[0]!;
    }
    const before = me.games;
    playGame(w, roster, host, { friendlyHost: hostCol ? new Set(["h-friend"]) : undefined, ring: ring ? { members: new Set(mates.map((m) => m.id)), target: me.id } : undefined });
    if (me.games > before) series.push(me.score);
  }
  return series;
}

function runLeague(seed: number, engine: Engine, weeks: number, noShow: number) {
  const w = newWorld(seed, { engine, noShow, turnout: 0.85 });
  const snap: Record<number, { rmse: number; rho: number }> = {};
  for (let wk = 1; wk <= weeks; wk++) {
    w.day = wk * 7; leagueWeek(w, new Set());
    if ([26, 52, 104].includes(wk)) snap[wk] = { rmse: rmse(w), rho: spearman(w) };
  }
  const strong = w.players.filter((p) => p.T >= 75);
  return { snap, rel: mean(w.players.map((p) => p.reliability)), games: mean(w.players.map((p) => p.games)), strongMean: mean(strong.map((p) => p.score)), strongT: mean(strong.map((p) => p.T)), maxScore: Math.max(...w.players.map((p) => p.score)) };
}

const f1 = (x: number | null) => (x == null ? "never" : Number.isFinite(x) ? x.toFixed(1) : "n/a");
const avgN = (xs: (number | null)[], horizon: number) => { const v = xs.map((x) => x ?? horizon); return { mean: mean(v), never: xs.filter((x) => x == null).length }; };

export function main(argv: string[]) {
  const quick = argv.includes("--quick");
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : null;
  const seeds = Array.from({ length: quick ? 3 : 10 }, (_, i) => 1000 + i * 7);
  const lines: string[] = [];
  const log = (s = "") => { lines.push(s); console.log(s); };

  log(`# Rating simulator results\n`);
  log(`${seeds.length} seeds per cell, league of 120 honest players, 40 weeks of burn-in, then 52 weeks with the subject. Hidden true skill T is on the rating scale. Smurf T=85, friend T=30. Everyone starts at 50.\n`);

  log(`## 1. Smurf and collusion: what a subject's rating does (mean over seeds)\n`);
  log(`Games to reach a score of 70, 78 (3.5 stars) and 90 (4.5 stars). A run that never gets there counts as 52 in the mean; the "never reach 78" column says how many of the runs that was. Score after 10, 26 and 52 games. Last column: score after 52 games minus true skill T.\n`);
  log(`| Subject | Engine | to 70 | to 78 | to 90 | never reach 78 | @10 | @26 | @52 | final - T |`);
  log(`|---|---|---|---|---|---|---|---|---|---|`);
  const subjects: [Subject, string, number][] = [
    ["honest_strong_mixed", "Honest strong (T=85), mixed games, honest hosts and voters", 85],
    ["smurf_friendly_host", "Smurf (T=85), weak games only, friendly host", 85],
    ["smurf_host_and_voters", "Smurf (T=85), weak games only, friendly host + 3 voters", 85],
    ["honest_weak_control", "Honest weak (T=30), mixed games (control)", 30],
    ["friend_host_only", "Weak friend (T=30), colluding host only", 30],
    ["friend_voters_only", "Weak friend (T=30), 3 colluding voters only", 30],
    ["friend_host_and_voters", "Weak friend (T=30), colluding host + 3 voters", 30],
  ];
  for (const [subject, label, T] of subjects) {
    for (const engine of ENGINES) {
      const runs = seeds.map((s) => runSubject(s, engine, subject));
      const r70 = avgN(runs.map((r) => firstReach(r, 70)), 52), r78 = avgN(runs.map((r) => firstReach(r, 78)), 52), r90 = avgN(runs.map((r) => firstReach(r, 90)), 52);
      const col = (n: number) => mean(runs.map((r) => at(r, n)));
      log(`| ${engine === "v1" ? label : ""} | ${engine} | ${f1(r70.mean)} | ${f1(r78.mean)} | ${f1(r90.mean)} | ${r78.never}/${seeds.length} | ${f1(col(10))} | ${f1(col(26))} | ${f1(col(52))} | ${f1(col(52) - T)} |`);
    }
  }

  log(`\n## 2. Honest league: rating error against true skill\n`);
  log(`Everyone honest, 8% no-shows. RMSE of (score - T) and rank correlation (Spearman) with true skill. Top = players with T >= 75: their mean score and mean T.\n`);
  log(`| Engine | RMSE @26w | RMSE @52w | RMSE @104w | rank corr @52w | top mean score | top mean T | highest score |`);
  log(`|---|---|---|---|---|---|---|---|`);
  for (const engine of ENGINES) {
    const rs = seeds.map((s) => runLeague(s, engine, 104, 0.08));
    const m = (k: 26 | 52 | 104, f: "rmse" | "rho") => mean(rs.map((r) => r.snap[k]![f]));
    log(`| ${engine} | ${f1(m(26, "rmse"))} | ${f1(m(52, "rmse"))} | ${f1(m(104, "rmse"))} | ${m(52, "rho").toFixed(2)} | ${f1(mean(rs.map((r) => r.strongMean)))} | ${f1(mean(rs.map((r) => r.strongT)))} | ${f1(mean(rs.map((r) => r.maxScore)))} |`);
  }

  log(`\n## 3. No-shows\n`);
  log(`Honest league, 52 weeks. A no-show costs 7 reliability and the game may fall below 4 players and not count.\n`);
  log(`| No-show rate | Engine | RMSE @52w | rank corr | mean reliability | mean games played |`);
  log(`|---|---|---|---|---|---|`);
  for (const ns of [0, 0.1, 0.25]) {
    for (const engine of ENGINES) {
      const rs = seeds.map((s) => runLeague(s, engine, 52, ns));
      log(`| ${engine === "v1" ? `${ns * 100}%` : ""} | ${engine} | ${f1(mean(rs.map((r) => r.snap[52]!.rmse)))} | ${mean(rs.map((r) => r.snap[52]!.rho)).toFixed(2)} | ${f1(mean(rs.map((r) => r.rel)))} | ${f1(mean(rs.map((r) => r.games)))} |`);
    }
  }
  log(`\n## 4. Sensitivity: how fast the field factor bites (v2, field_gain_scale)\n`);
  log(`Larger scale = gains shrink more slowly as a player rises above the field. Honest strong player (T=85) in mixed games against the smurf in weak games with a friendly host. Score after 26 and 52 games, mean over seeds.\n`);
  log(`| field_gain_scale | honest strong @26 | honest strong @52 | smurf @26 | smurf @52 | gap @52 |`);
  log(`|---|---|---|---|---|---|`);
  for (const scale of [10, 15, 25, 40, 80]) {
    const cfg = { ...DEFAULT_CONFIG, field_gain_scale: scale };
    const h = seeds.map((sd) => runSubject(sd, "v2", "honest_strong_mixed", 52, 0.08, cfg));
    const m = seeds.map((sd) => runSubject(sd, "v2", "smurf_friendly_host", 52, 0.08, cfg));
    const hm = (n: number) => mean(h.map((r) => at(r, n))), mm = (n: number) => mean(m.map((r) => at(r, n)));
    log(`| ${scale}${scale === 15 ? " (default)" : ""} | ${f1(hm(26))} | ${f1(hm(52))} | ${f1(mm(26))} | ${f1(mm(52))} | ${f1(hm(52) - mm(52))} |`);
  }
  if (out) writeFileSync(out, lines.join("\n") + "\n");
}

if (process.argv[1] && /rating_sim\.ts$/.test(process.argv[1])) main(process.argv.slice(2));
