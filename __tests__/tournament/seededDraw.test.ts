import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, noSeedColumns: false }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => ({
      ...fakeClient(h.db as never),
      from: (table: string) => {
        const q = fakeClient(h.db as never).from(table) as { insert: (rows: Record<string, unknown>[]) => unknown };
        if (table !== "tournament_group_members" || !h.noSeedColumns) return q;
        // a database without migration 20261109000000: any row that names a seed column is refused
        const insert = q.insert.bind(q);
        q.insert = (rows) => (rows.some((r) => "seed" in r) ? Promise.resolve({ data: null, error: { message: 'column "seed" of relation "tournament_group_members" does not exist', code: "42703" } }) : insert(rows));
        return q;
      },
      auth: { getUser: async () => ({ data: { user: { id: "admin1" } }, error: null }) } }),
  };
});

import { POST } from "../../app/api/admin/tournaments/bracket/route";
import { applyDrawSeeds } from "../../lib/tournament/publicBracket";
import { drawSeededGroups, getGroupConfig, rankTeams, seededRandom, type DrawTeam, type GroupDraw } from "../../lib/tournament/seededDraw";
import { seedTeams } from "../../lib/tournament/seeding";

/** n fake teams with evenly spread averages: Team 1 is 4.50 and the last is 3.00, so the true order is the order of the names. */
const spread = (n: number): DrawTeam[] => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, avg: Math.round((4.5 - (1.5 * i) / (n - 1)) * 100) / 100 }));
const shuffle = <T,>(a: T[], r: () => number) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j]!, x[i]!]; } return x; };
const signature = (d: GroupDraw) => d.groups.map((g) => g.teams.map((t) => t.id).sort().join(",")).join("|");
const groupAvg = (g: GroupDraw["groups"][number]) => g.teams.reduce((s, t) => s + (t.avg ?? 0), 0) / g.teams.length;
const spreadOf = (d: GroupDraw) => { const a = d.groups.map(groupAvg); return Math.max(...a) - Math.min(...a); };
const RUNS = 400;

describe("the draw for 8, 9, 10, 11 and 12 teams (hundreds of random draws each)", () => {
  for (const n of [8, 9, 10, 11, 12]) {
    describe(`${n} teams`, () => {
      const teams = spread(n);
      const config = getGroupConfig(n);
      const draws = Array.from({ length: RUNS }, (_, i) => drawSeededGroups(shuffle(teams, seededRandom(1000 + i)), seededRandom(i + 1)));

      it("group sizes are right, every team is in exactly one group, and the seeds follow the ratings", () => {
        for (const d of draws) {
          expect(d.groups.map((g) => g.teams.length)).toEqual(config.teamsPerGroup);
          expect(d.groups.flatMap((g) => g.teams.map((t) => t.id)).sort()).toEqual(teams.map((t) => t.id).sort());
          expect(d.ranked.map((t) => t.id)).toEqual(teams.map((t) => t.id)); // distinct averages: seed order is rating order
          expect(d.ranked.map((t) => t.seed)).toEqual(teams.map((_, i) => i + 1));
        }
      });

      it("pots are the top N, the next N, and so on; the last pot may be smaller", () => {
        const d = draws[0]!;
        const N = config.groupCount;
        for (const t of d.ranked) expect(t.pot).toBe(Math.floor((t.seed - 1) / N) + 1);
        const sizes = new Map<number, number>();
        for (const t of d.ranked) sizes.set(t.pot, (sizes.get(t.pot) ?? 0) + 1);
        const last = Math.max(...sizes.keys());
        for (const [pot, count] of sizes) expect(count).toBe(pot === last ? n - N * (last - 1) : N);
        if (n === 11) expect([...sizes.values()]).toEqual([3, 3, 3, 2]);
      });

      it("no two teams of one pot share a group", () => {
        for (const d of draws) for (const g of d.groups) {
          const pots = g.teams.map((t) => t.pot);
          expect(new Set(pots).size).toBe(pots.length);
        }
      });

      it("group averages are balanced: tighter than a plain random shuffle, and never lopsided", () => {
        const seeded = draws.map(spreadOf);
        const plain = Array.from({ length: RUNS }, (_, i) => {
          const order = shuffle(teams, seededRandom(5000 + i));
          let k = 0;
          const groups = config.teamsPerGroup.map((size) => { const g = order.slice(k, k + size); k += size; return { name: "", teams: g.map((t, j) => ({ ...t, seed: j, pot: 1 })) }; });
          return spreadOf({ ranked: [], groups, pot_size: config.groupCount });
        });
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        expect(mean(seeded)).toBeLessThan(mean(plain) * 0.6);
        expect(Math.max(...seeded)).toBeLessThan(Math.max(...plain));
        expect(Math.max(...seeded)).toBeLessThan(n === 11 ? 0.55 : 0.42); // out of a 1.5 spread of ratings
      });

      it("it is still random: not the same draw every time, and a top seed meets different groupmates", () => {
        const distinct = new Set(draws.map(signature));
        expect(distinct.size).toBeGreaterThan(15);
        const mates = new Set(draws.map((d) => d.groups.find((g) => g.teams.some((t) => t.id === "t1"))!.teams.map((t) => t.id).filter((id) => id !== "t1").join(",")));
        expect(mates.size).toBeGreaterThan(3);
      });

      it("every team of a pot lands in every group about equally often", () => {
        const counts = new Map<string, number>();
        for (const d of draws) d.groups.forEach((g, gi) => g.teams.forEach((t) => counts.set(`${t.id}@${gi}`, (counts.get(`${t.id}@${gi}`) ?? 0) + 1)));
        for (const t of teams) {
          const pot = Math.floor(teams.indexOf(t) / config.groupCount) + 1;
          const lastPartial = pot === Math.ceil(n / config.groupCount) && n % config.groupCount !== 0;
          for (let gi = 0; gi < config.groupCount; gi++) {
            const share = (counts.get(`${t.id}@${gi}`) ?? 0) / RUNS;
            if (lastPartial) continue; // the last pot of 11 only goes to the two groups of four: checked below
            expect(share, `${t.id} in group ${gi}`).toBeGreaterThan(1 / config.groupCount - 0.12);
            expect(share, `${t.id} in group ${gi}`).toBeLessThan(1 / config.groupCount + 0.12);
          }
        }
      });
    });
  }

  it("11 teams: the group of three takes one team from each of the three top pots, never from the last pot, and the pick is even", () => {
    const teams = spread(11);
    const draws = Array.from({ length: 900 }, (_, i) => drawSeededGroups(shuffle(teams, seededRandom(i)), seededRandom(i + 77)));
    const small = (d: GroupDraw) => d.groups.find((g) => g.teams.length === 3)!;
    for (const d of draws) {
      expect(small(d).teams.map((t) => t.pot).sort()).toEqual([1, 2, 3]);
      // the two groups of four each take one from every pot, so both bottom teams are split between them
      const big = d.groups.filter((g) => g.teams.length === 4);
      expect(big.map((g) => g.teams.filter((t) => t.pot === 4).length)).toEqual([1, 1]);
    }
    // within a pot, every team is equally likely to be the one the small group gets (one in three), so it favours nobody
    for (const id of ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"]) {
      const share = draws.filter((d) => small(d).teams.some((t) => t.id === id)).length / draws.length;
      expect(share, id).toBeGreaterThan(0.26);
      expect(share, id).toBeLessThan(0.41);
    }
    // the small group lands on a different group letter all the time too
    expect(new Set(draws.map((d) => d.groups.findIndex((g) => g.teams.length === 3))).size).toBe(1); // sizes are fixed per letter (A 4, B 4, C 3)
  });
});

describe("ties, teams with nobody rated, and roster sizes", () => {
  it("teams level on the average are ordered at random, and the same random source gives the same order", () => {
    const teams: DrawTeam[] = Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, name: `T${i + 1}`, avg: i < 4 ? 4 : 3 }));
    const firsts = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const d = drawSeededGroups(teams, seededRandom(i));
      firsts.add(d.ranked[0]!.id);
      expect(d.ranked.slice(0, 4).every((t) => ["t1", "t2", "t3", "t4"].includes(t.id))).toBe(true); // the better average is always above the lower
    }
    expect(firsts.size).toBe(4);
    expect(drawSeededGroups(teams, seededRandom(9)).ranked.map((t) => t.id)).toEqual(drawSeededGroups(teams, seededRandom(9)).ranked.map((t) => t.id));
  });

  it("nobody rated anywhere is a plain random draw, and never crashes", () => {
    const seeded = seedTeams(spread(9).map((t) => ({ id: t.id, team_name: t.name, user_ids: [`${t.id}a`, `${t.id}b`] })), new Map());
    expect(seeded.every((s) => s.team_avg == null && s.seed == null)).toBe(true);
    const teams: DrawTeam[] = seeded.map((s, i) => ({ id: s.id, name: `Team ${i + 1}`, avg: s.team_avg }));
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const d = drawSeededGroups(teams, seededRandom(i));
      expect(d.groups.map((g) => g.teams.length)).toEqual([3, 3, 3]);
      expect(d.ranked.map((t) => t.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      seen.add(d.ranked.map((t) => t.id).join());
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it("a team whose players have no rating yet counts as the field average, so it sits in the middle, not first or last", () => {
    const ratings = new Map<string, { exact: number; ratedGames: number | null }>();
    const make = (id: string, r: number | null) => { if (r != null) ratings.set(`${id}1`, { exact: r, ratedGames: 10 }); return { id, team_name: id, user_ids: [`${id}1`] }; };
    const inputs = [make("hi", 4.4), make("mid1", 3.6), make("mid2", 3.4), make("lo", 2.6), make("fresh", null)];
    const avg = new Map(seedTeams(inputs, ratings).map((s) => [s.id, s.team_avg]));
    expect(avg.get("fresh")).toBe(3.5); // the mean of the four rated players
    const ranked = rankTeams(inputs.map((t) => ({ id: t.id, name: t.id, avg: avg.get(t.id) ?? null })), seededRandom(1)).map((r) => r.team.id);
    expect(ranked).toEqual(["hi", "mid1", "fresh", "mid2", "lo"]);
    // a player with a card but no rated game is treated the same way
    expect(seedTeams([make("x", null), make("y", null)], new Map([["x1", { exact: 1, ratedGames: 0 }], ["y1", { exact: 4, ratedGames: 5 }]]))[0]!.team_avg).toBe(4);
  });

  it("a team with no average at all sits at the middle of the others", () => {
    const ranked = rankTeams([{ id: "a", name: "a", avg: 4 }, { id: "b", name: "b", avg: 2 }, { id: "n", name: "n", avg: null }], seededRandom(3)).map((r) => r.team.id);
    expect(ranked).toEqual(["a", "n", "b"]);
  });

  it("roster size does not matter: the average decides, a bigger roster is not favoured", () => {
    const ratings = new Map<string, { exact: number; ratedGames: number | null }>();
    const team = (id: string, players: number[]) => ({ id, team_name: id, user_ids: players.map((p, i) => { ratings.set(`${id}-${i}`, { exact: p, ratedGames: 8 }); return `${id}-${i}`; }) });
    const big = team("big", Array(12).fill(3.0)); // twelve players: the sum is 36
    const small = team("small", Array(5).fill(3.4)); // five players: the sum is 17
    const seeds = new Map(seedTeams([big, small], ratings).map((s) => [s.id, s]));
    expect(seeds.get("small")!.team_avg).toBe(3.4);
    expect(seeds.get("big")!.team_avg).toBe(3.0);
    expect(seeds.get("small")!.seed).toBe(1);
    expect(seeds.get("big")!.seed).toBe(2);
    // and the draw uses those averages
    const d = drawSeededGroups([{ id: "big", name: "big", avg: 3.0 }, { id: "small", name: "small", avg: 3.4 }, ...spread(6).map((t) => ({ ...t, avg: 2 }))], seededRandom(2));
    expect(d.ranked.slice(0, 2).map((t) => t.id)).toEqual(["small", "big"]);
  });

  it("the same players on the same ratings always give the same seeds; new ratings give new seeds (a redraw uses the current ratings)", () => {
    const before = spread(8);
    const after = before.map((t) => ({ ...t, avg: t.id === "t8" ? 5 : t.avg })); // the last team improved
    expect(drawSeededGroups(before, seededRandom(4)).ranked[7]!.id).toBe("t8");
    expect(drawSeededGroups(after, seededRandom(4)).ranked[0]!.id).toBe("t8");
    expect(drawSeededGroups(after, seededRandom(4)).ranked[0]!.seed).toBe(1);
  });
});

describe("Generate Groups stores the seed and shows it (the route, with a fake database)", () => {
  const T = "tour-1";
  function world(columns: boolean): FakeDb {
    const caps = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, tournament_id: T, status: "payment_received", team_name: `Team ${i + 1}`, captain_name: `Cap ${i + 1}`, user_id: `u${i + 1}` }));
    const db = makeDb({
      profiles: [{ id: "admin1", is_admin: true }],
      tournaments: [{ id: T, slug: "fall", min_roster_players: 1, rated: false, count_for_season: false }],
      tournament_captains: caps,
      tournament_roster: [],
      tournament_groups: [],
      tournament_group_members: [],
      tournament_matches: [],
      tournament_match_goals: [],
      admin_audit_log: [],
      user_push_devices: [],
      // Team 1 is the best (4.4) down to Team 8 (3.0)
      player_cards: caps.map((c, i) => ({ user_id: c.user_id, rating_exact: 4.4 - i * 0.2, rated_games: 10 })),
    });
    db.mintIds = ["tournament_groups", "tournament_matches", "tournament_group_members"];
    if (!columns) {
      const original = db.tables.tournament_group_members!;
      const push = original.push.bind(original);
      original.push = (...rows: Record<string, unknown>[]) => {
        if (rows.some((r) => "seed" in r)) throw new Error("never reached: the fake reports the error below instead");
        return push(...rows);
      };
    }
    return db;
  }
  const generate = async () => {
    const res = await POST(new Request("https://site.test/api/admin/tournaments/bracket", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, action: "generate", confirm_wipe: true }) }));
    return { status: res.status, json: (await res.json()) as { draw?: { group: string; teams: Record<string, unknown>[] }[]; message?: string } };
  };
  beforeEach(() => {
    h.db = world(true);
    h.noSeedColumns = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  });

  it("seeds, pots and group places are stored with each team and returned to the admin", async () => {
    const r = await generate();
    expect(r.status).toBe(200);
    const rows = (h.db as FakeDb).tables.tournament_group_members!;
    expect(rows).toHaveLength(8);
    expect(rows.map((m) => m.seed).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const m of rows) {
      const team = Number(String(m.team_id).slice(1));
      expect(m.seed).toBe(team); // Team 1 has the best average, so seed 1
      expect(m.pot).toBe(Math.floor((team - 1) / 2) + 1);
      expect(m.draw_avg).toBe(Math.round((4.4 - (team - 1) * 0.2) * 100) / 100);
    }
    // two groups of four, one team from each pot in each group
    const byGroup = new Map<unknown, unknown[]>();
    for (const m of rows) byGroup.set(m.group_id, [...(byGroup.get(m.group_id) ?? []), m.pot]);
    for (const pots of byGroup.values()) expect((pots as number[]).sort()).toEqual([1, 2, 3, 4]);
    expect(r.json.draw!.flatMap((g) => g.teams.map((t) => Object.keys(t).sort().join()))).toEqual(Array(8).fill("pot,seed,team_id,team_name"));
    // the group stage is still a round robin: 6 matches in each group of 4
    expect((h.db as FakeDb).tables.tournament_matches).toHaveLength(12);
  });

  it("the draw is written to the audit log with the display average, never a raw score", async () => {
    await generate();
    const log = (h.db as FakeDb).tables.admin_audit_log!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: "admin1", action: "tournament_group_draw" });
    const teams = (log[0]!.detail as { teams: Record<string, unknown>[] }).teams;
    expect(teams).toHaveLength(8);
    expect(Object.keys(teams[0]!).sort()).toEqual(["avg", "group", "pot", "seed", "team_id"]);
  });

  it("running it again redraws from the current ratings", async () => {
    await generate();
    const cards = (h.db as FakeDb).tables.player_cards!;
    cards.find((c) => c.user_id === "u8")!.rating_exact = 5;
    const r = await generate();
    expect(r.status).toBe(200);
    const rows = (h.db as FakeDb).tables.tournament_group_members!;
    expect(rows).toHaveLength(8);
    expect(rows.find((m) => m.team_id === "c8")!.seed).toBe(1);
    expect(rows.find((m) => m.team_id === "c1")!.seed).toBe(2);
  });

  it("before the migration (no seed columns) the draw still works and stores the plain rows", async () => {
    h.noSeedColumns = true;
    const r = await generate();
    expect(r.status).toBe(200);
    const rows = (h.db as FakeDb).tables.tournament_group_members!;
    expect(rows).toHaveLength(8);
    expect(rows.every((m) => !("seed" in m) && !("pot" in m))).toBe(true);
    expect((h.db as FakeDb).tables.tournament_matches).toHaveLength(12);
    expect(r.json.draw!.flatMap((g) => g.teams)).toHaveLength(8); // the admin still sees the seeds and pots in the response
  });
});

describe("what players can see", () => {
  it("the bracket shows the seed the draw used and its average, and nothing about pots", () => {
    const now = [{ id: "t1", seed: 5, team_avg: 3.1 }, { id: "t2", seed: 1, team_avg: 4.2 }, { id: "t3", seed: null, team_avg: null }];
    const out = applyDrawSeeds(now, [{ team_id: "t1", seed: 1, pot: 1, draw_avg: "4.40" }, { team_id: "t2", seed: 2, pot: 1, draw_avg: 4.1 }, { team_id: "t3", seed: null, pot: null }]);
    expect(out).toEqual([{ id: "t1", seed: 1, team_avg: 4.4 }, { id: "t2", seed: 2, team_avg: 4.1 }, { id: "t3", seed: null, team_avg: null }]);
    expect(applyDrawSeeds(now, [])).toEqual(now);
    expect(JSON.stringify(out)).not.toContain("pot");
  });

  it("the player facing bracket code never mentions pots or raw ratings", () => {
    for (const f of ["lib/tournament/publicBracket.ts", "app/api/tournament/public/route.ts", "mobile/app/tournament-bracket-view.tsx"]) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\bpot\b|draw_pot|\.pot\b/);
      expect(src, f).not.toMatch(/rating_exact|\bscore\b.*rating|player_ratings/);
    }
  });

  it("the only place a pot is shown is the admin bracket screen", () => {
    expect(readFileSync("mobile/app/(tabs)/admin/tournament-bracket.tsx", "utf8")).toMatch(/pot \$\{s\.pot\}/);
  });

  it("the migration is additive and guarded", () => {
    const sql = readFileSync("supabase/migrations/20261109000000_tournament_group_draw_seeds.sql", "utf8");
    expect(sql).toContain("to_regclass('public.tournament_group_members')");
    expect(sql).toContain("add column if not exists seed int");
    expect(sql.toLowerCase()).toContain("rollback");
    expect(sql.toLowerCase()).not.toMatch(/drop table|delete from|truncate/);
    expect(sql.includes("—")).toBe(false);
  });

  it("the knockout pairing is untouched", () => {
    const src = readFileSync("app/api/admin/tournaments/bracket/route.ts", "utf8");
    expect(src).toContain('action === "generate_knockout"');
    expect(readFileSync("lib/tournament/seededDraw.ts", "utf8").includes("—")).toBe(false);
  });
});
