import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient: client } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => client(h.db as never),
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: "viewer" } }, error: null }) } }),
  };
});

import { GET } from "../../app/api/tournament/list/route";
import { summarizeTournaments } from "../../lib/tournament/tournamentList";
import {
  FINISHED_GRACE_MS,
  HOME_WINDOW_MS,
  STALE_AFTER_MS,
  homeTournament,
  listedTournaments,
  parseTournamentList,
  subtitleText,
  whenText,
  type TournamentListItem,
} from "../../mobile/lib/tournamentEntryCore";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// Saturday 10:00 AM Eastern.
const NOW = Date.parse("2026-11-14T15:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const t = (o: Partial<TournamentListItem> & { id: string }): TournamentListItem => ({
  title: `Tournament ${o.id}`,
  start_at: iso(NOW + 2 * DAY),
  venue: null,
  service_region: null,
  live: false,
  has_bracket: false,
  final_completed_at: null,
  ...o,
});

describe("Events tab: who is listed", () => {
  it("nothing to list means the section is hidden", () => {
    expect(listedTournaments([], NOW)).toEqual([]);
  });

  it("lists upcoming tournaments however far ahead, soonest first, and undated ones last", () => {
    const out = listedTournaments(
      [t({ id: "far", start_at: iso(NOW + 40 * DAY) }), t({ id: "undated", start_at: null }), t({ id: "soon", start_at: iso(NOW + 2 * DAY) })],
      NOW,
    );
    expect(out.map((x) => x.id)).toEqual(["soon", "far", "undated"]);
  });

  it("a tournament with a match being played goes first", () => {
    const out = listedTournaments([t({ id: "soon" }), t({ id: "live", start_at: iso(NOW - 3 * HOUR), live: true, has_bracket: true })], NOW);
    expect(out.map((x) => x.id)).toEqual(["live", "soon"]);
  });

  it("drops a tournament 24 hours after its final has a result, and keeps it until then", () => {
    const done = (ago: number) => t({ id: "done", start_at: iso(NOW - DAY), has_bracket: true, final_completed_at: iso(NOW - ago) });
    expect(listedTournaments([done(FINISHED_GRACE_MS - HOUR)], NOW)).toHaveLength(1);
    expect(listedTournaments([done(FINISHED_GRACE_MS)], NOW)).toHaveLength(0);
  });

  it("drops a forgotten tournament that started over 14 days ago, unless a match is being played", () => {
    const old = (live: boolean) => t({ id: "old", start_at: iso(NOW - STALE_AFTER_MS - HOUR), has_bracket: true, live });
    expect(listedTournaments([old(false)], NOW)).toHaveLength(0);
    expect(listedTournaments([old(true)], NOW)).toHaveLength(1);
  });
});

describe("Home card: when it shows", () => {
  it("hidden when there are no tournaments", () => {
    expect(homeTournament([], NOW)).toBeNull();
  });

  it("shown when a tournament starts within 7 days, including exactly 7 days out", () => {
    expect(homeTournament([t({ id: "a", start_at: iso(NOW + 2 * DAY) })], NOW)?.id).toBe("a");
    expect(homeTournament([t({ id: "edge", start_at: iso(NOW + HOME_WINDOW_MS) })], NOW)?.id).toBe("edge");
  });

  it("hidden when the only tournament is more than 7 days away", () => {
    expect(homeTournament([t({ id: "far", start_at: iso(NOW + HOME_WINDOW_MS + HOUR) })], NOW)).toBeNull();
  });

  it("shown while a tournament is under way, with or without a match being played right now", () => {
    expect(homeTournament([t({ id: "on", start_at: iso(NOW - 2 * HOUR), has_bracket: true })], NOW)?.id).toBe("on");
    expect(homeTournament([t({ id: "live", start_at: iso(NOW - 2 * HOUR), live: true })], NOW)?.live).toBe(true);
  });

  it("hidden when it has no date, even though the Events tab lists it", () => {
    const undated = t({ id: "u", start_at: null });
    expect(homeTournament([undated], NOW)).toBeNull();
    expect(listedTournaments([undated], NOW)).toHaveLength(1);
  });

  it("hidden once it is over or forgotten", () => {
    expect(homeTournament([t({ id: "d", start_at: iso(NOW - 2 * DAY), has_bracket: true, final_completed_at: iso(NOW - 2 * DAY) })], NOW)).toBeNull();
    expect(homeTournament([t({ id: "s", start_at: iso(NOW - STALE_AFTER_MS - DAY) })], NOW)).toBeNull();
  });

  it("with several, shows the one being played, then the soonest", () => {
    const list = [t({ id: "later", start_at: iso(NOW + 5 * DAY) }), t({ id: "soon", start_at: iso(NOW + DAY) }), t({ id: "live", start_at: iso(NOW - HOUR), live: true })];
    expect(homeTournament(list, NOW)?.id).toBe("live");
    expect(homeTournament(list.filter((x) => !x.live), NOW)?.id).toBe("soon");
  });
});

describe("what the card says", () => {
  it("says when, in Eastern time", () => {
    expect(whenText(t({ id: "a", start_at: "2026-11-14T22:00:00Z" }), NOW)).toBe("Starts today, 5:00 PM ET");
    expect(whenText(t({ id: "a", start_at: "2026-11-15T19:00:00Z" }), NOW)).toBe("Starts tomorrow, 2:00 PM ET");
    expect(whenText(t({ id: "a", start_at: "2026-11-17T19:00:00Z" }), NOW)).toBe("Starts Tuesday, 2:00 PM ET");
    expect(whenText(t({ id: "a", start_at: "2026-11-24T19:00:00Z" }), NOW)).toBe("Starts Nov 24, 2:00 PM ET");
  });

  it("says what is happening once it has started, and when there is no date", () => {
    expect(whenText(t({ id: "a", live: true, start_at: iso(NOW - HOUR) }), NOW)).toBe("Matches under way");
    expect(whenText(t({ id: "a", start_at: iso(NOW - HOUR), has_bracket: true }), NOW)).toBe("Under way");
    expect(whenText(t({ id: "a", start_at: iso(NOW - HOUR) }), NOW)).toBe("Started");
    expect(whenText(t({ id: "a", start_at: null }), NOW)).toBe("Date to be announced");
  });

  it("puts the venue after the time", () => {
    expect(subtitleText(t({ id: "a", start_at: "2026-11-15T19:00:00Z", venue: "Field 3" }), NOW)).toBe("Starts tomorrow, 2:00 PM ET · Field 3");
  });

  it("reads the list route's response and drops anything without an id", () => {
    expect(parseTournamentList({ tournaments: [{ id: "a", title: "A", live: true }, { title: "no id" }, null] })).toEqual([
      { id: "a", title: "A", start_at: null, venue: null, service_region: null, live: true, has_bracket: false, final_completed_at: null },
    ]);
    expect(parseTournamentList(null)).toEqual([]);
    expect(parseTournamentList({ tournaments: "x" })).toEqual([]);
  });
});

describe("the list route", () => {
  const T1 = "t1";
  function poisonedDb(): FakeDb {
    return makeDb({
      profiles: [{ id: "viewer", approved: true, is_admin: false }],
      tournaments: [
        { id: T1, title: "TEST Bracket Demo (delete me)", slug: "test-bracket-demo", is_active: true, canceled_at: null, start_at: "2026-11-15T19:00:00Z", venue: "TEST field", service_region: "ct", stripe_account: "acct_SECRET", staff_announcement: "SECRET_NOTE", entry_fee_cents: 25000 },
        { id: "off", title: "Inactive", is_active: false, canceled_at: null, start_at: "2026-11-16T19:00:00Z" },
        { id: "cx", title: "Canceled", is_active: true, canceled_at: "2026-11-01T00:00:00Z", start_at: "2026-11-16T19:00:00Z" },
      ],
      tournament_matches: [
        { tournament_id: T1, stage: "group", is_bye: false, started_at: "2026-11-15T19:05:00Z", completed_at: null, team_a_id: "SECRET_TEAM" },
        { tournament_id: T1, stage: "group", is_bye: false, started_at: "2026-11-15T19:00:00Z", completed_at: "2026-11-15T19:40:00Z" },
        { tournament_id: "other", stage: "final", is_bye: false, started_at: "x", completed_at: "y" },
      ],
    });
  }
  const get = () => GET(new Request("https://site.test/api/tournament/list", { headers: { authorization: "Bearer token" } }));

  beforeEach(() => {
    h.db = poisonedDb();
  });

  it("returns only active, not canceled tournaments, with exactly the allow-listed fields", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournaments).toHaveLength(1);
    expect(Object.keys(body.tournaments[0]).sort()).toEqual(
      ["final_completed_at", "has_bracket", "id", "live", "service_region", "start_at", "title", "venue"].sort(),
    );
    expect(body.tournaments[0]).toMatchObject({ id: T1, live: true, has_bracket: true, final_completed_at: null, service_region: "CT" });
    const text = JSON.stringify(body);
    for (const secret of ["acct_SECRET", "SECRET_NOTE", "SECRET_TEAM", "slug", "25000", "stripe"]) expect(text).not.toContain(secret);
  });

  it("a tournament with no match in play is not live", async () => {
    (h.db as FakeDb).tables.tournament_matches = [{ tournament_id: T1, stage: "group", is_bye: false, started_at: null, completed_at: null }];
    const body = await (await get()).json();
    expect(body.tournaments[0]).toMatchObject({ live: false, has_bracket: true });
  });

  it("no tournaments is an empty list, not an error", async () => {
    (h.db as FakeDb).tables.tournaments = [];
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tournaments: [] });
  });

  it("needs a signed-in, approved account", async () => {
    expect((await GET(new Request("https://site.test/api/tournament/list"))).status).toBe(401);
    (h.db as FakeDb).tables.profiles = [{ id: "viewer", approved: false, is_admin: false }];
    expect((await get()).status).toBe(403);
    (h.db as FakeDb).tables.profiles = [{ id: "viewer", approved: false, is_admin: true }];
    expect((await get()).status).toBe(200);
  });

  it("summarizeTournaments: byes never count as live, and the final's result time is reported", () => {
    const out = summarizeTournaments(
      [{ id: "a", title: "A", start_at: "2026-11-15T19:00:00Z" }],
      [
        { tournament_id: "a", stage: "sf", is_bye: true, started_at: "x", completed_at: null },
        { tournament_id: "a", stage: "final", is_bye: false, started_at: "x", completed_at: "2026-11-15T22:00:00Z" },
      ],
    );
    expect(out[0]).toMatchObject({ live: false, has_bracket: true, final_completed_at: "2026-11-15T22:00:00Z" });
  });
});

describe("where the entry points are wired", () => {
  it("the Events tab shows the Tournaments section above 'This week'", () => {
    const panel = src("mobile/components/fields/EventsPanel.tsx");
    expect(panel.indexOf("<TournamentsSection />")).toBeGreaterThan(0);
    expect(panel.indexOf("<TournamentsSection />")).toBeLessThan(panel.indexOf("This week"));
  });

  it("Home shows the card directly under the date strip, before the selected day", () => {
    const home = src("mobile/app/(tabs)/index.tsx");
    expect(home).toMatch(/belowStrip=\{<HomeTournamentCard \/>\}/);
    const cal = src("mobile/components/home/HomeCalendar.tsx");
    const strip = cal.indexOf("keyExtractor={(o) => String(o)}");
    expect(cal.indexOf("{belowStrip}")).toBeGreaterThan(strip);
    expect(cal.indexOf("{belowStrip}")).toBeLessThan(cal.indexOf("styles.dayHeader}>"));
  });

  it("both hide completely (render nothing) when there is nothing to show", () => {
    expect(src("mobile/components/tournament/TournamentsSection.tsx")).toMatch(/if \(listed\.length === 0\) return null;/);
    expect(src("mobile/components/tournament/HomeTournamentCard.tsx")).toMatch(/if \(!t\) return null;/);
  });

  it("both open the live bracket, and the card shows the Live tag only when a match is being played", () => {
    expect(src("mobile/components/tournament/TournamentEntryCard.tsx")).toMatch(/\/tournament-bracket-view\?tournament_id=/);
    expect(src("mobile/components/tournament/TournamentEntryCard.tsx")).toMatch(/\{item\.live \? <LiveTag \/> : null\}/);
  });

  it("reuses the press card, the shared motion config and Reduce Motion", () => {
    const card = src("mobile/components/tournament/TournamentEntryCard.tsx");
    expect(card).toMatch(/AnimatedPressScale/);
    expect(card).toMatch(/MOTION\.pressScale\.card/);
    expect(card).toMatch(/MOTION\.duration\.base/);
    expect(card).toMatch(/useReduceMotion/);
    expect(src("mobile/components/tournament/LiveTag.tsx")).toMatch(/MOTION\.duration\.slow/);
  });

  it("the list refreshes only while the screen is focused and the app is in the foreground", () => {
    const hook = src("mobile/hooks/useTournamentList.ts");
    expect(hook).toMatch(/useScreenActive/);
    expect(hook).toMatch(/if \(!active \|\| !token\) return;/);
    expect(hook).toMatch(/clearInterval\(timer\)/);
    expect(src("mobile/hooks/useScreenActive.ts")).toMatch(/AppState\.addEventListener\("change"/);
  });

  it("new copy has no em dash and no tier or wave wording", () => {
    for (const f of [
      "mobile/lib/tournamentEntryCore.ts",
      "mobile/components/tournament/TournamentEntryCard.tsx",
      "mobile/components/tournament/TournamentsSection.tsx",
      "mobile/components/tournament/HomeTournamentCard.tsx",
      "mobile/components/tournament/LiveTag.tsx",
      "lib/tournament/tournamentList.ts",
      "app/api/tournament/list/route.ts",
      "scripts/test-tournament/seed.sql",
      "scripts/test-tournament/cleanup.sql",
    ]) {
      expect(src(f), f).not.toMatch(/—/);
      expect(src(f), f).not.toMatch(/\btier\b|\bwave\b/i);
    }
  });
});
