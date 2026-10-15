import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCsvs, candidateUrls, collectTask, COVERAGE_COLUMNS, CSV_COLUMNS, coverageCsv, pendingTasks, planTasks, skippedGroups, skippedReport, summarize, taskKey, unusualKept, unusualScore, type Outcome, type School, type Task } from "../scripts/roster-research/core";
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
  const out = (rowsIn: unknown[], over: Partial<Outcome> = {}) => ({ key: "k", school: "S", division: "D3", conference: "X", team: "men", season: 2026, status: "ok", urls_tried: ["u"], source_url: "u", format: "list", players_on_page: 3, rows_kept: rowsIn.length, skipped_non_target: 1, skipped_foreign_or_unreadable: 0, parse_failures: 0, failure_notes: [], error: "", rows: rowsIn, ...over }) as unknown as Outcome;

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

describe("parse_failures counts only real parse problems", () => {
  const okPage = (html: string) => ({ get: async (url: string) => ({ url, status: 200, body: html, fromCache: false }) });

  it("is 0 for a clean page, even with filter, wrapper and placeholder <li> elements", async () => {
    const r = parseRosterHtml(fx("list_clean.html"));
    expect(r.players.map((p) => p.name)).toEqual(["Reese Clean", "Sky Clean"]);
    expect(r.failures).toEqual([]);
    const o = await collectTask(task(), okPage(fx("list_clean.html")), "now");
    expect(o.parse_failures).toBe(0);
    expect(o.urls_tried.length).toBe(1);
    expect(o).toMatchObject({ players_on_page: 2, rows_kept: 1, skipped_non_target: 1, skipped_foreign_or_unreadable: 0 });
  });
  it("is 0 for the other clean fixtures too", async () => {
    for (const f of ["list.html", "table.html", "card.html"]) expect(parseRosterHtml(fx(f)).failures, f).toEqual([]);
    expect((await collectTask(task(), okPage(fx("table.html")), "now")).parse_failures).toBe(0);
  });
  it("is 1 when a player row on the page really cannot be turned into a row", async () => {
    const r = parseRosterHtml(fx("list_broken_row.html"));
    expect(r.players).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/without a name/);
    expect((await collectTask(task(), okPage(fx("list_broken_row.html")), "now")).parse_failures).toBe(1);
  });
  it("does not count a table's total or blank rows", () => {
    const html = `<table><tr><th>Name</th><th>Pos.</th><th>Cl.</th><th>Hometown/High School</th></tr>
      <tr><td>A Player</td><td>D</td><td>Sr.</td><td>Newtown, Conn.</td></tr>
      <tr><td></td><td></td><td></td><td></td></tr><tr><td>Total</td><td>-</td><td>-</td><td></td></tr></table>`;
    const r = parseRosterHtml(html);
    expect(r.players).toHaveLength(2);
    expect(r.failures).toEqual([]);
  });
});

describe("hometown strings in the nine target states are read", () => {
  const cases: [string, string, string][] = [
    ["Newtown, Conn.", "Newtown", "CT"], ["Newtown, CT", "Newtown", "CT"], ["Newtown, Connecticut", "Newtown", "CT"], ["Newtown, Conn", "Newtown", "CT"], ["Newtown, Ct.", "Newtown", "CT"],
    ["Brooklyn, N.Y.", "Brooklyn", "NY"], ["Brooklyn, NY", "Brooklyn", "NY"], ["Brooklyn, New York", "Brooklyn", "NY"], ["Brooklyn, N.Y", "Brooklyn", "NY"], ["Manhattan, NYC", "Manhattan", "NY"],
    ["Newark, N.J.", "Newark", "NJ"], ["Newark, New Jersey", "Newark", "NJ"], ["Newark, NJ 07102", "Newark", "NJ"],
    ["Worcester, Mass.", "Worcester", "MA"], ["Worcester, Massachusetts", "Worcester", "MA"], ["Boston, MA.", "Boston", "MA"],
    ["Bethesda, Md.", "Bethesda", "MD"], ["Baltimore, Maryland", "Baltimore", "MD"],
    ["Philadelphia, Pa.", "Philadelphia", "PA"], ["Pittsburgh, Pennsylvania", "Pittsburgh", "PA"], ["Erie, Penn.", "Erie", "PA"],
    ["Dover, Del.", "Dover", "DE"], ["Wilmington, Delaware", "Wilmington", "DE"],
    ["Providence, R.I.", "Providence", "RI"], ["Newport, Rhode Island", "Newport", "RI"], ["Warwick, RI", "Warwick", "RI"],
    ["Washington, D.C.", "Washington", "DC"], ["Wash., D.C.", "Washington", "DC"], ["Washington, DC", "Washington", "DC"], ["Washington D.C.", "Washington", "DC"], ["Washington, District of Columbia", "Washington", "DC"], ["D.C.", "Washington", "DC"],
    // extra text around the state
    ["Newtown, Conn., USA", "Newtown", "CT"], ["Newtown, Conn. (USA)", "Newtown", "CT"], ["Hartford, Connecticut USA", "Hartford", "CT"], ["Stamford, Conn.,", "Stamford", "CT"],
    ["Brooklyn N.Y.", "Brooklyn", "NY"], ["Stamford CT", "Stamford", "CT"], ["Newark New Jersey", "Newark", "NJ"],
    ["Brooklyn, N.Y. / Poly Prep", "Brooklyn", "NY"], ["Pittsburgh, Pa./Shady Side Academy", "Pittsburgh", "PA"], ["Darien, Conn. (Brunswick School)", "Darien", "CT"], ["Greenwich, CT 06830", "Greenwich", "CT"],
    ["Brooklyn, NY Poly Prep", "Brooklyn", "NY"], ["Boston, Mass., Boston Latin", "Boston", "MA"],
  ];
  it.each(cases)("%s", (raw, city, state) => {
    expect(parseHometown(raw)).toMatchObject({ city, state, kind: "us" });
  });
  it("still refuses places outside the US and things it can't read", () => {
    for (const raw of ["London, England", "Toronto, Ontario", "Toronto, Ontario, Canada", "Springfield", "NYC", "Madrid, Spain", ""]) expect(parseHometown(raw).state, raw).toBeNull();
    expect(parseHometown("Austin, Texas")).toMatchObject({ state: "TX" });
    expect(parseHometown("Washington, Wash.")).toMatchObject({ state: "WA" });
  });
});

describe("the skipped / unusual-hometown report (raw text only)", () => {
  const o = (school_: string, season: number, skipped: string[], kept: { raw: string; had_extra: boolean }[] = []) =>
    ({ key: `${school_}${season}`, school: school_, division: "D3", conference: "X", team: "men", season, status: "ok", urls_tried: [], source_url: "", format: "list", players_on_page: 0, rows_kept: kept.length, skipped_non_target: 0, skipped_foreign_or_unreadable: skipped.length, parse_failures: 0, failure_notes: [], error: "", rows: [], skipped_raw: skipped, kept_raw: kept }) as unknown as Outcome;

  it("records the raw hometown of every skipped player, and never a name or a high school", async () => {
    const page = { get: async (url: string) => ({ url, status: 200, body: fx("list.html"), fromCache: false }) };
    const r = await collectTask(task(), page, "now");
    expect(r.skipped_raw).toEqual(["Toronto, Ontario", ""]);
    expect(JSON.stringify([r.skipped_raw, r.kept_raw])).not.toMatch(/Drew Fixture|Emery Nohome|Alex Example|Newtown HS/);
    const t = await collectTask(task(), { get: async (url) => ({ url, status: 200, body: fx("table.html"), fromCache: false }) }, "now");
    expect(t.skipped_raw).toEqual(["London, England"]);
    expect(JSON.stringify(t.kept_raw)).not.toMatch(/Poly Prep|Walt Whitman|Central High/);
    expect(t.kept_raw!.find((k) => k.raw === "Brooklyn, N.Y.")).toMatchObject({ had_extra: true }); // the "/ Poly Prep" part was dropped
  });
  it("groups by distinct raw text with a count and where it came from", () => {
    const g = skippedGroups([o("Amherst", 2026, ["London, England", "", "London, England", "Springfield"]), o("Bates", 2026, ["London, England"])]);
    expect(g[0]).toMatchObject({ raw: "London, England", count: 3 });
    expect(g[0]!.where).toEqual([{ school: "Amherst", season: 2026, count: 2 }, { school: "Bates", season: 2026, count: 1 }]);
    expect(g.map((x) => x.raw).sort()).toEqual(["", "London, England", "Springfield"]);
  });
  it("lists the 10 most unusual kept strings", () => {
    const kept = [
      { raw: "Newtown, Conn.", had_extra: false }, { raw: "Newtown, Conn.", had_extra: false },
      { raw: "Brooklyn, N.Y.", had_extra: true }, { raw: "Boston, Mass. (USA)", had_extra: false }, { raw: "Newark,, N.J.", had_extra: false }, { raw: "ST. LOUIS, MO.", had_extra: false },
    ];
    const odd = unusualKept([o("A", 2026, [], kept)]);
    expect(odd.map((x) => x.raw)).toEqual(["Boston, Mass. (USA)", "Brooklyn, N.Y.", "Newark,, N.J.", "ST. LOUIS, MO."]); // plain "Newtown, Conn." is not listed
    expect(unusualScore("Newtown, Conn.", false)).toBe(0);
    expect(unusualScore("Brooklyn, N.Y.", true)).toBeGreaterThan(0);
    expect(unusualKept([o("A", 2026, [], Array.from({ length: 30 }, (_, i) => ({ raw: `Town ${i}, N.Y. (x)`, had_extra: false }))) ], 10)).toHaveLength(10);
  });
  it("prints a readable report, and says when older pages have no raw text yet", () => {
    const lines = skippedReport([o("Amherst", 2026, ["London, England"], [{ raw: "Brooklyn, N.Y.", had_extra: true }]), { ...o("Bates", 2026, []), skipped_raw: undefined }]).join("\n");
    expect(lines).toMatch(/Skipped as foreign or unreadable: 1 players, 1 distinct/);
    expect(lines).toMatch(/"London, England"\s+\[Amherst College|"London, England"\s+\[Amherst 2026/);
    expect(lines).toMatch(/--reparse/);
    expect(lines).toMatch(/a '\/' part was dropped/);
  });

  it("--show-skipped prints from the local work file without fetching (and --reparse reads only the cache)", () => {
    const out = mkdtempSync(join(tmpdir(), "roster-out-"));
    mkdirSync(join(out, ".work"), { recursive: true });
    const line = JSON.stringify(o("Amherst College", 2026, ["London, England", "London, England", "Narnia"], [{ raw: "Brooklyn, N.Y.", had_extra: true }])).replace('"key":"Amherst College2026"', '"key":"amherst|men|2026"');
    writeFileSync(join(out, ".work", "outcomes.jsonl"), line + "\n");
    const run = (args: string[]) =>
      spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--phase", "1", "--out", out, ...args], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "" } });
    const shown = run(["--show-skipped"]);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toMatch(/Skipped as foreign or unreadable: 3 players, 2 distinct/);
    expect(shown.stdout).toMatch(/"London, England"/);
    expect(shown.stdout).toMatch(/Brooklyn, N\.Y\./);
    expect(shown.stdout).not.toMatch(/Fetched \d+ pages/); // nothing was fetched (and no contact email was needed)
    const re = run(["--reparse"]);
    expect(re.status, re.stderr).toBe(0);
    expect(re.stdout).toMatch(/Re-parsed 0 of 22 pages from the cache \(no network\)/); // nothing cached: the old result stays
  });
});

describe("offline fetcher", () => {
  it("reads cached pages and never touches the network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "roster-"));
    let calls = 0;
    const live = new PoliteFetcher({ cacheDir: dir, userAgent: "UA", sleep: async () => undefined, fetchImpl: async () => { calls++; return { status: 200, text: async () => "<html>page</html>" }; } });
    await live.get("https://a.example.edu/p");
    const before = calls;
    const offline = new PoliteFetcher({ cacheDir: dir, userAgent: "UA", offline: true, fetchImpl: async () => { calls++; throw new Error("network used"); } });
    expect(await offline.get("https://a.example.edu/p")).toMatchObject({ status: 200, fromCache: true });
    expect(await offline.get("https://a.example.edu/not-cached")).toMatchObject({ status: 0, error: expect.stringMatching(/offline/) });
    expect(calls).toBe(before);
  });
});

import { buildOutreach, OUTREACH_COLUMNS, outreachCsv, outreachSummary, sortOutreach, splitName, STATE_ORDER, type OutreachRow } from "../scripts/roster-research/outreach";
import type { Row } from "../scripts/roster-research/core";

describe("outreach: splitting names", () => {
  it.each([
    ["Jordan Smith", "Jordan", "Smith", ""],
    ["Jordan Smith Jr.", "Jordan", "Smith", "Jr"],
    ["Jordan Smith, Jr.", "Jordan", "Smith", "Jr"],
    ["Jordan Smith III", "Jordan", "Smith", "III"],
    ["Jordan Smith IV", "Jordan", "Smith", "IV"],
    ["Ana Garcia-Lopez", "Ana", "Garcia-Lopez", ""],
    ["Jordan De La Cruz", "Jordan", "De La Cruz", ""],
    ["Jordan De La Cruz Jr.", "Jordan", "De La Cruz", "Jr"],
    ["Ethan Van Dyke", "Ethan", "Van Dyke", ""],
    ["Mia St. Pierre", "Mia", "St. Pierre", ""],
    ["Sean O'Neil", "Sean", "O'Neil", ""],
    ["John A. Smith", "John", "Smith", ""],
    ["Mary Beth Smith", "Mary Beth", "Smith", ""],
    ['Jonathan "JT" Smith', "Jonathan", "Smith", ""],
    ["Jonathan (JT) Smith", "Jonathan", "Smith", ""],
    ["  Zoë   Núñez ", "Zoë", "Núñez", ""],
  ])("%s", (full, first, last, suffix) => {
    expect(splitName(full)).toEqual({ first, last, suffix });
  });
  it("won't split a single name or an ambiguous comma, and never guesses", () => {
    for (const n of ["Pelé", "Madonna Jr.", "", "  ", "Smith, John", "Smith, John Jr."]) expect(splitName(n), n).toBeNull();
  });
});

describe("outreach: sorting", () => {
  const r = (state: string, season: number, school: string, last: string, first = "A"): OutreachRow => ({ first_name: first, last_name: last, school, hometown_city: "X", hometown_state: state, season, team: "men", status: "" });
  it("orders states CT, NY, NJ, MA, MD, PA, DC, DE, RI, then newest season, school, last name", () => {
    expect([...STATE_ORDER]).toEqual(["CT", "NY", "NJ", "MA", "MD", "PA", "DC", "DE", "RI"]);
    const rows = [
      r("RI", 2026, "A", "Z"), r("DE", 2026, "A", "Z"), r("DC", 2026, "A", "Z"), r("PA", 2026, "A", "Z"), r("MD", 2026, "A", "Z"), r("MA", 2026, "A", "Z"), r("NJ", 2026, "A", "Z"), r("NY", 2026, "A", "Z"),
      r("CT", 2014, "A", "Z"), r("CT", 2026, "B", "Y"), r("CT", 2018, "A", "Z"), r("CT", 2026, "A", "Z"), r("CT", 2022, "A", "Z"), r("CT", 2026, "A", "Adams"), r("CT", 2026, "B", "Adams"),
    ];
    const sorted = sortOutreach(rows).map((x) => `${x.hometown_state} ${x.season} ${x.school} ${x.last_name}`);
    expect(sorted).toEqual([
      "CT 2026 A Adams", "CT 2026 A Z", "CT 2026 B Adams", "CT 2026 B Y", "CT 2022 A Z", "CT 2018 A Z", "CT 2014 A Z",
      "NY 2026 A Z", "NJ 2026 A Z", "MA 2026 A Z", "MD 2026 A Z", "PA 2026 A Z", "DC 2026 A Z", "DE 2026 A Z", "RI 2026 A Z",
    ]);
  });
});

describe("outreach: building the list", () => {
  const row = (over: Partial<Row> = {}): Row => ({ school: "Trinity College (CT)", division: "D3", conference: "NESCAC", team: "men", season: 2026, name: "Alex Example", class_year: "SR", position: "MF", hometown_city: "Westport", hometown_state: "CT", source_url: "u", collected_at: "t", duplicate_of_existing: "", ...over });

  it("has the requested columns, hometown_city for every state, and a blank status", () => {
    const b = buildOutreach([row(), row({ name: "Sam Sample", hometown_city: "Albany", hometown_state: "NY" })]);
    expect([...OUTREACH_COLUMNS]).toEqual(["first_name", "last_name", "school", "hometown_city", "hometown_state", "season", "team", "status"]);
    expect(b.rows.map((x) => [x.first_name, x.last_name, x.hometown_city, x.hometown_state, x.status])).toEqual([["Alex", "Example", "Westport", "CT", ""], ["Sam", "Sample", "Albany", "NY", ""]]);
    const csv = outreachCsv(b.rows).trim().split("\n");
    expect(csv[0]).toBe("first_name,last_name,school,hometown_city,hometown_state,season,team,status");
    expect(csv[0]).not.toMatch(/email|phone|instagram|twitter|handle|contact|high_school|photo/i);
  });
  it("merges the same player across seasons only when name, school, team and hometown all match, keeping the newest season", () => {
    const b = buildOutreach([row({ season: 2018 }), row({ season: 2026 }), row({ season: 2022, class_year: "SO" })]);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]!.season).toBe(2026);
    expect(b.merged).toBe(2);
  });
  it("keeps both rows when it is unsure: another hometown, another school, another team, or a different suffix", () => {
    const b = buildOutreach([
      row({ name: "Pat Same", hometown_city: "Westport" }), row({ name: "Pat Same", hometown_city: "Stamford", season: 2022 }), // same name and school, different town
      row({ name: "Lee Move", school: "Tufts University" }), row({ name: "Lee Move", school: "Trinity College (CT)", season: 2022 }), // a transfer
      row({ name: "Kim Both", team: "men" }), row({ name: "Kim Both", team: "women", season: 2022 }),
      row({ name: "Joe Line" }), row({ name: "Joe Line Jr.", season: 2022 }), row({ name: "Joe Line III", season: 2018 }),
    ]);
    expect(b.merged).toBe(0);
    expect(b.rows).toHaveLength(9);
    expect(b.keptSeparate).toBe(1); // Pat Same
  });
  it("ignores case, accents and punctuation when matching names and towns", () => {
    const b = buildOutreach([row({ name: "José O'Neil", hometown_city: "St. Louis", season: 2022 }), row({ name: "JOSE ONEIL", hometown_city: "st louis", season: 2026 })]);
    expect(b.rows).toHaveLength(1);
    expect(b.merged).toBe(1);
  });
  it("logs single names and ambiguous commas instead of guessing, and leaves them out of the list", () => {
    const b = buildOutreach([row({ name: "Pelé" }), row({ name: "Smith, John" }), row({ name: "Real Person" })]);
    expect(b.rows.map((x) => x.last_name)).toEqual(["Person"]);
    expect(b.unsplit.map((u) => [u.name, u.reason])).toEqual([["Pelé", "single name"], ["Smith, John", "ambiguous comma"]]);
  });
  it("leaves out D1 rows flagged as already held, unless asked", () => {
    const rows = [row({ division: "D1", duplicate_of_existing: "true", name: "Held Player" }), row({ name: "New Player" })];
    expect(buildOutreach(rows).rows.map((x) => x.first_name)).toEqual(["New"]);
    expect(buildOutreach(rows).excludedExisting).toBe(1);
    expect(buildOutreach(rows, { includeDuplicateOfExisting: true }).rows).toHaveLength(2);
  });
  it("prints a short summary: total, per state, merged, unsplit", () => {
    const b = buildOutreach([row(), row({ season: 2022 }), row({ name: "Cher", hometown_state: "NY", hometown_city: "Troy" }), row({ name: "Dee Eff", hometown_state: "NY", hometown_city: "Troy" })]);
    const text = outreachSummary(b).join("\n");
    expect(text).toMatch(/Outreach list: 2 rows/);
    expect(text).toMatch(/CT: 1/);
    expect(text).toMatch(/NY: 1/);
    expect(text).toMatch(/NJ: 0/);
    expect(text).toMatch(/Duplicates merged.*: 1/);
    expect(text).toMatch(/could not be split.*: 1/);
  });
  it("--export-outreach writes the file from the collected CSVs, offline, and nothing else", () => {
    const out = mkdtempSync(join(tmpdir(), "roster-out-"));
    const header = "school,division,conference,team,season,name,class_year,position,hometown_city,hometown_state,source_url,collected_at,duplicate_of_existing";
    writeFileSync(join(out, "D3_2026.csv"), `${header}\nTufts University,D3,NESCAC,men,2026,"Dan Fairfield Jr.",SR,MF,Fairfield,CT,u,t,\nTufts University,D3,NESCAC,women,2026,Pelé,FR,F,Newark,NJ,u,t,\n`);
    writeFileSync(join(out, "D3_2022.csv"), `${header}\nTufts University,D3,NESCAC,men,2022,Dan Fairfield Jr.,JR,MF,Fairfield,CT,u,t,\n`);
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--export-outreach", "--out", out], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "" } });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Outreach list: 1 rows/);
    expect(res.stdout).toMatch(/Duplicates merged.*: 1/);
    expect(res.stdout).toMatch(/not split \(single name\): "Pelé"/);
    const list = readFileSync(join(out, "outreach_list.csv"), "utf8").trim().split("\n");
    expect(list).toEqual(["first_name,last_name,school,hometown_city,hometown_state,season,team,status", "Dan,Fairfield,Tufts University,Fairfield,CT,2026,men,"]);
    expect(readFileSync(join(out, "outreach_unsplit.csv"), "utf8")).toMatch(/Pelé/);
  });
});

describe("outreach stays a by-hand list", () => {
  it("has no network calls, no social sites and no contact fields anywhere in the roster tooling", () => {
    for (const f of ["outreach.ts", "core.ts", "sidearm.ts", "hometown.ts", "states.ts"]) {
      const src = readFileSync(new URL(`../scripts/roster-research/${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/instagram|twitter|facebook|tiktok|linkedin|snapchat|\bx\.com\b|mailto:|sendMessage|\bsms\b/i);
    }
    expect(readFileSync(new URL("../scripts/roster-research/outreach.ts", import.meta.url), "utf8")).not.toMatch(/\bfetch\s*\(|https?:\/\//);
    expect(readFileSync(new URL("../.gitignore", import.meta.url), "utf8")).toMatch(/^\/data\/outreach\/rosters\/$/m);
  });
});
