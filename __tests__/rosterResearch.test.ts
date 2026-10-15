import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCsvs, candidateUrls, collectTask, COVERAGE_COLUMNS, CSV_COLUMNS, coverageCsv, messiestRows, pendingTasks, planTasks, summarize, taskKey, type Outcome, type School, type Task } from "../scripts/roster-research/core";
import { buildUserAgent, PoliteFetcher, robotsAllows, waybackUrl, type FetchLike } from "../scripts/roster-research/fetcher";
import { normalizeClass, parseHometown } from "../scripts/roster-research/hometown";
import { parseRosterHtml } from "../scripts/roster-research/sidearm";
import { isTargetState, normalizeState } from "../scripts/roster-research/states";

const fx = (n: string) => readFileSync(new URL(`./fixtures/roster/${n}`, import.meta.url), "utf8");
const school = (over: Partial<School> = {}): School => ({ id: "ex", school: "Example College", division: "D3", conference: "NESCAC", base: "https://athletics.example.edu", ...over });
const task = (over: Partial<Task> = {}): Task => ({ school: school(), team: "men", season: 2026, ...over });

describe("states", () => {
  it("normalizes AP abbreviations, names and codes", () => {
    for (const [raw, code] of [["Conn.", "CT"], ["Connecticut", "CT"], ["CT", "CT"], ["N.Y.", "NY"], ["New York", "NY"], ["N.J.", "NJ"], ["Mass.", "MA"], ["Md.", "MD"], ["Pa.", "PA"], ["Penn.", "PA"], ["Del.", "DE"], ["R.I.", "RI"], ["Texas", "TX"], ["Calif.", "CA"]] as const)
      expect(normalizeState(raw), raw).toBe(code);
  });
  it("maps every way of writing Washington, D.C. to DC, and a bare Washington to the state", () => {
    for (const raw of ["D.C.", "DC", "Washington, D.C.", "Washington DC", "District of Columbia"]) expect(normalizeState(raw), raw).toBe("DC");
    expect(normalizeState("Washington")).toBe("WA");
  });
  it("does not guess", () => {
    for (const raw of ["Ontario", "England", "", "  ", null, undefined, "Narnia"]) expect(normalizeState(raw as never), String(raw)).toBeNull();
    expect(["CT", "NY", "NJ", "MA", "MD", "PA", "DC", "DE", "RI"].every(isTargetState)).toBe(true);
    expect(isTargetState("TX")).toBe(false);
  });
});

describe("hometown and class", () => {
  it("keeps city and state and drops the high school", () => {
    expect(parseHometown("Brooklyn, N.Y. / Poly Prep")).toMatchObject({ city: "Brooklyn", state: "NY", kind: "us" });
    expect(parseHometown("Philadelphia, Pa. / Central High School (PA)")).toMatchObject({ city: "Philadelphia", state: "PA" });
    expect(parseHometown("Newtown, Conn.")).toMatchObject({ city: "Newtown", state: "CT", messy: false });
  });
  it("handles Washington, D.C. and foreign or unreadable hometowns without guessing", () => {
    expect(parseHometown("Washington, D.C.")).toMatchObject({ city: "Washington", state: "DC" });
    expect(parseHometown("London, England")).toMatchObject({ state: null, kind: "foreign" });
    expect(parseHometown("Toronto, Ontario")).toMatchObject({ state: null, kind: "foreign" });
    expect(parseHometown("Springfield")).toMatchObject({ state: null });
    expect(parseHometown("")).toMatchObject({ state: null, kind: "unreadable" });
  });
  it("normalizes class years", () => {
    for (const [raw, cls] of [["Fr.", "FR"], ["So.", "SO"], ["Jr.", "JR"], ["Sr.", "SR"], ["Gr.", "GR"], ["R-Fr.", "R-FR"], ["Redshirt Sophomore", "R-SO"], ["Senior", "SR"], ["5th", "GR"], ["", ""]] as const)
      expect(normalizeClass(raw), raw).toBe(cls);
  });
});

describe("parser (fixtures are hand-written approximations of three Sidearm layouts)", () => {
  it("list layout", () => {
    const r = parseRosterHtml(fx("list.html"));
    expect(r.format).toBe("list");
    expect(r.players.map((p) => p.name)).toEqual(["Alex Example", "Bailey Sample", "Casey Testcase", "Drew Fixture", "Emery Nohome", "Alex Example"]);
    expect(r.players[0]).toMatchObject({ classYear: "SR", position: "MF", hometown: { city: "Newtown", state: "CT" } });
    expect(r.players[1]!.hometown).toMatchObject({ city: "Washington", state: "DC" });
  });
  it("table layout, reading columns by their header names", () => {
    const r = parseRosterHtml(fx("table.html"));
    expect(r.format).toBe("table");
    expect(r.players).toHaveLength(6);
    expect(r.players[0]).toMatchObject({ name: "Frankie Tablerow", classYear: "GR", position: "D", hometown: { city: "Brooklyn", state: "NY" } });
    expect(r.players[2]!.hometown).toMatchObject({ city: "Philadelphia", state: "PA" });
    expect(r.players[5]!.classYear).toBe("R-SO");
  });
  it("card layout", () => {
    const r = parseRosterHtml(fx("card.html"));
    expect(r.format).toBe("card");
    expect(r.players).toHaveLength(2);
    expect(r.players[0]).toMatchObject({ name: "Lane Cardsmith", classYear: "JR", position: "Forward", hometown: { city: "Worcester", state: "MA" } });
  });
  it("never keeps a high school, height, weight or photo", () => {
    for (const f of ["list.html", "table.html", "card.html"]) {
      const json = JSON.stringify(parseRosterHtml(fx(f)).players);
      expect(json).not.toMatch(/Newtown HS|Poly Prep|Walt Whitman|Doherty|5'10|160 lbs|photo1|\/sports\//);
    }
  });
  it("reports an unrecognised page as a failure instead of inventing rows", () => {
    expect(parseRosterHtml("<html><body><p>Page not found</p></body></html>")).toMatchObject({ format: "none", players: [] });
  });
});

describe("collecting a page", () => {
  const okPage = (html: string) => ({ get: async (url: string) => ({ url, status: 200, body: html, fromCache: false }) });

  it("keeps only target-state hometowns, skips the rest, and dedupes", async () => {
    const o = await collectTask(task(), okPage(fx("list.html")), "2026-10-15T00:00:00Z");
    expect(o.status).toBe("ok");
    expect(o.players_on_page).toBe(6);
    expect(o.rows.map((r) => `${r.name}|${r.hometown_state}`)).toEqual(["Alex Example|CT", "Bailey Sample|DC"]); // duplicate Alex dropped
    expect(o.skipped_non_target).toBe(1); // Texas
    expect(o.skipped_foreign_or_unreadable).toBe(2); // Toronto + the empty hometown
    expect(o.rows[0]).toMatchObject({ school: "Example College", division: "D3", conference: "NESCAC", team: "men", season: 2026, class_year: "SR", position: "MF", hometown_city: "Newtown" });
    expect(o.rows[0]!.source_url).toBe("https://athletics.example.edu/sports/mens-soccer/roster/2026");
    expect(Object.keys(o.rows[0]!).sort()).toEqual([...CSV_COLUMNS].sort());
  });
  it("logs a missing page and never invents rows", async () => {
    const o = await collectTask(task(), { get: async (url) => ({ url, status: 404, body: "", fromCache: false }) }, "now");
    expect(o).toMatchObject({ status: "missing", rows_kept: 0 });
    expect(o.urls_tried.length).toBeGreaterThan(1);
  });
  it("calls a network error a failure (to retry), not a missing page", async () => {
    const o = await collectTask(task(), { get: async (url) => ({ url, status: 0, body: "", fromCache: false, error: "ECONNRESET" }) }, "now");
    expect(o).toMatchObject({ status: "failed", error: "ECONNRESET" });
  });
  it("a robots.txt block is a missing page, not a retry", async () => {
    const o = await collectTask(task(), { get: async (url) => ({ url, status: 0, body: "", fromCache: false, blockedByRobots: true, error: "disallowed by robots.txt" }) }, "now");
    expect(o.status).toBe("missing");
  });
  it("marks a D1 row for a season already held as duplicate_of_existing", async () => {
    const o = await collectTask(task({ school: school({ division: "D1" }), season: 2024 }), okPage(fx("card.html")), "now");
    expect(o.rows.every((r) => r.duplicate_of_existing === "true")).toBe(true);
    const o2 = await collectTask(task({ school: school({ division: "D1" }), season: 2022 }), okPage(fx("card.html")), "now");
    expect(o2.rows.every((r) => r.duplicate_of_existing === "")).toBe(true);
  });
  it("lists the messiest rows", async () => {
    const o = await collectTask(task(), okPage(fx("list.html")), "now");
    expect(messiestRows([o], 3)[0]!.score).toBeGreaterThanOrEqual(3);
  });
});

describe("planning, candidates, resuming", () => {
  const schools = [school({ id: "a" }), school({ id: "b", conference: "Other" }), school({ id: "c", division: "D1" })];
  it("plans men's and women's pages for the chosen divisions, seasons and conference", () => {
    const t = planTasks(schools, { divisions: ["D3"], seasons: [2026], conference: "nescac" });
    expect(t.map(taskKey)).toEqual(["a|men|2026", "a|women|2026"]);
    expect(planTasks(schools, { divisions: ["D3", "D1"], seasons: [2022, 2018] })).toHaveLength(3 * 2 * 2);
  });
  it("tries the season page, then the current page, then the Wayback Machine for old seasons", () => {
    expect(candidateUrls(task({ season: 2026 }))).toEqual([
      "https://athletics.example.edu/sports/mens-soccer/roster/2026", "https://athletics.example.edu/sports/mens-soccer/roster/2026-27", "https://athletics.example.edu/sports/mens-soccer/roster",
    ]);
    const old = candidateUrls(task({ season: 2018, team: "women" }));
    expect(old[0]).toBe("https://athletics.example.edu/sports/womens-soccer/roster/2018");
    expect(old[2]).toBe(waybackUrl(2018, old[0]!));
  });
  it("a new run skips finished pages and redoes failed ones only when asked", () => {
    const tasks = planTasks([school({ id: "a" }), school({ id: "z" })], { divisions: ["D3"], seasons: [2026] });
    const o = (key: string, status: Outcome["status"]) => ({ key, status }) as Outcome;
    const done = new Map([["a|men|2026", o("a|men|2026", "ok")], ["a|women|2026", o("a|women|2026", "failed")], ["z|men|2026", o("z|men|2026", "missing")]]);
    expect(pendingTasks(tasks, done, false).map(taskKey)).toEqual(["z|women|2026"]);
    expect(pendingTasks(tasks, done, true).map(taskKey)).toEqual(["a|women|2026", "z|women|2026"]);
  });
});

describe("CSV and coverage", () => {
  const rows = (school_: string, name: string, extra = {}) => ({ school: school_, division: "D3", conference: "X", team: "men", season: 2026, name, class_year: "SR", position: "MF", hometown_city: "Newtown", hometown_state: "CT", source_url: "u", collected_at: "t", duplicate_of_existing: "", ...extra });
  const out = (rowsIn: unknown[], over: Partial<Outcome> = {}) => ({ key: "k", school: "S", division: "D3", conference: "X", team: "men", season: 2026, status: "ok", urls_tried: ["u"], source_url: "u", format: "list", players_on_page: 3, rows_kept: rowsIn.length, skipped_non_target: 1, skipped_foreign_or_unreadable: 0, parse_failures: 0, failure_notes: [], error: "", rows: rowsIn, messy: [], ...over }) as unknown as Outcome;

  it("writes one CSV per division-season with exactly the allowed columns, deduped and quoted", () => {
    const csvs = buildCsvs([out([rows("A", "Pat O'Neil, Jr."), rows("A", "Pat O'Neil, Jr.")]), out([rows("B", "Sam")], { key: "k2" }), out([rows("C", "Lee", { division: "D2", season: 2022 })], { key: "k3", division: "D2", season: 2022 })]);
    expect([...csvs.keys()].sort()).toEqual(["D2_2022.csv", "D3_2026.csv"]);
    const lines = csvs.get("D3_2026.csv")!.trim().split("\n");
    expect(lines[0]).toBe("school,division,conference,team,season,name,class_year,position,hometown_city,hometown_state,source_url,collected_at,duplicate_of_existing");
    expect(lines).toHaveLength(3); // header + 2 (the duplicate Pat is gone)
    expect(lines[1]).toContain('"Pat O\'Neil, Jr."');
    expect(lines[0]).not.toMatch(/email|phone|twitter|instagram|photo|high_school|height|weight/i);
  });
  it("counts what was attempted, found, kept, skipped and failed", () => {
    const os = [out([rows("A", "x")]), out([], { key: "m", status: "missing", skipped_non_target: 0 }), out([], { key: "f", status: "failed", skipped_non_target: 0, error: "ECONNRESET" })];
    expect(summarize(os)).toMatchObject({ tasks: 3, pagesFound: 1, missing: 1, failed: 1, rowsKept: 1, skippedNonTarget: 1 });
    const csv = coverageCsv(os).trim().split("\n");
    expect(csv[0]).toBe(COVERAGE_COLUMNS.join(","));
    expect(csv).toHaveLength(4);
  });
});

describe("polite fetcher", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "roster-"));
  function setup(responses: Record<string, { status: number; body: string }> = {}) {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let now = 1_000_000;
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push(`${url}|${init.headers["User-Agent"]}`);
      const r = responses[url] ?? { status: 200, body: "<html>ok</html>" };
      return { status: r.status, text: async () => r.body };
    };
    const f = new PoliteFetcher({ cacheDir: dir(), userAgent: "UA test@example.com", fetchImpl, sleep: async (ms) => void (sleeps.push(ms), (now += ms)), now: () => now });
    return { f, calls, sleeps };
  }

  it("needs a real contact email and puts it in the User-Agent", () => {
    expect(() => buildUserAgent(undefined)).toThrow(/ROSTER_CONTACT_EMAIL/);
    expect(() => buildUserAgent("not an email")).toThrow();
    expect(buildUserAgent("me@example.com")).toMatch(/contact: me@example\.com/);
  });
  it("never fetches the same page twice, even a 404", async () => {
    const { f, calls } = setup({ "https://a.example.edu/missing": { status: 404, body: "" } });
    await f.get("https://a.example.edu/page");
    const again = await f.get("https://a.example.edu/page");
    await f.get("https://a.example.edu/missing");
    const again404 = await f.get("https://a.example.edu/missing");
    expect(again.fromCache).toBe(true);
    expect(again404).toMatchObject({ status: 404, fromCache: true });
    expect(calls.filter((c) => c.includes("/page")).length).toBe(1);
    expect(calls.filter((c) => c.includes("/missing")).length).toBe(1);
    expect(calls.every((c) => c.endsWith("|UA test@example.com"))).toBe(true);
  });
  it("waits a full second between requests to the same host (robots.txt counts as a request), and not between different hosts", async () => {
    const { f, sleeps } = setup();
    await f.get("https://a.example.edu/1"); // a: robots.txt, then the page
    await f.get("https://a.example.edu/2"); // a: one more
    await f.get("https://b.example.edu/1"); // b: robots.txt, then the page
    expect(sleeps).toEqual([1000, 1000, 1000]); // a waited twice, b once; moving from a to b waited for nothing
  });
  it("honours robots.txt", async () => {
    const { f, calls } = setup({ "https://a.example.edu/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private/" } });
    expect(await f.get("https://a.example.edu/private/roster")).toMatchObject({ blockedByRobots: true, status: 0 });
    expect((await f.get("https://a.example.edu/sports/mens-soccer/roster/2026")).status).toBe(200);
    expect(calls.some((c) => c.includes("/private/"))).toBe(false);
  });
  it("parses robots rules: longest match wins, our agent's group beats *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: CTPickupRosterResearch\nDisallow: /admin\nAllow: /admin/public";
    expect(robotsAllows(txt, "/sports/x")).toBe(true);
    expect(robotsAllows(txt, "/admin/x")).toBe(false);
    expect(robotsAllows(txt, "/admin/public/x")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/anything")).toBe(false);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
  it("treats a network error as retryable: nothing is cached and the host is not blocked for the run", async () => {
    let n = 0;
    const f = new PoliteFetcher({ cacheDir: dir(), userAgent: "UA", sleep: async () => undefined, fetchImpl: async () => { n++; if (n === 1) throw new Error("ECONNRESET"); return { status: 200, text: async () => "ok" }; } });
    const first = await f.get("https://a.example.edu/p");
    expect(first).toMatchObject({ status: 0 });
    expect(first.error).toBeTruthy();
    const second = await f.get("https://a.example.edu/p");
    expect(second).toMatchObject({ status: 200, body: "ok" });
  });
});

describe("repo hygiene", () => {
  it("keeps the collected rows out of git and puts no email in code", () => {
    const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(gi).toMatch(/^\/data\/outreach\/rosters\/$/m);
    for (const f of ["core.ts", "fetcher.ts", "run.ts", "sidearm.ts", "hometown.ts", "states.ts"]) {
      expect(readFileSync(new URL(`../scripts/roster-research/${f}`, import.meta.url), "utf8")).not.toMatch(/[\w.+-]+@(gmail|yahoo|outlook)\.com/);
    }
  });
});
