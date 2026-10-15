import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { candidateUrls, coverageCsvWithSkips, planWithSkips, skipReason, type Getter, type School, type Task } from "../scripts/roster-research/core";
import { PoliteFetcher, type FetchLike } from "../scripts/roster-research/fetcher";
import { detectPlatform, detectSchoolPlatform, prestoRosterPattern, sidearmRosterUrl, verifyRoster } from "../scripts/roster-research/platform";
import {
  applyOverrides, buildSchoolLists, collectTeam, combineTeams, enrichAll, loadSchoolFiles, mergeSchools, needsReviewLines, problemGroup, schoolReport, type SchoolRecord, type SourcesConfig,
} from "../scripts/roster-research/schoolList";
import { parseNcaaDirectory, parseSchoolTables, siteOrigin } from "../scripts/roster-research/sources";

const fx = (n: string) => readFileSync(new URL(`./fixtures/roster/${n}`, import.meta.url), "utf8");

/** A fake fetcher: answers from a map, records every request, and never touches the network. */
function fake(map: Record<string, { status?: number; body?: string; error?: string; robots?: boolean }> = {}) {
  const requests: string[] = [];
  const getter: Getter = {
    get: async (url) => {
      requests.push(url);
      const r = map[url];
      if (!r) return { url, status: 404, body: "", fromCache: false };
      if (r.robots) return { url, status: 0, body: "", fromCache: false, blockedByRobots: true, error: "disallowed by robots.txt" };
      if (r.error) return { url, status: 0, body: "", fromCache: false, error: r.error };
      return { url, status: r.status ?? 200, body: r.body ?? "", fromCache: false };
    },
  };
  return { getter, requests };
}

const rec = (over: Partial<SchoolRecord> = {}): SchoolRecord => ({ id: "ex", school: "Example College", division: "D3", conference: "X", base: "https://ex.edu", platform: "unknown", roster: { status: "unchecked", reason: "" }, ...over });

describe("platform detection (fixtures are hand-written approximations)", () => {
  it.each([["home_sidearm.html", "sidearm"], ["home_presto.html", "prestosports"], ["home_wmt.html", "wmt"], ["home_unknown.html", "unknown"]])("%s is %s", (file, platform) => {
    expect(detectPlatform(fx(file)).platform).toBe(platform);
  });
  it("detects Athletics.com", () => {
    expect(detectPlatform('<script src="https://assets.athletics.com/x.js"></script>').platform).toBe("athleticsdotcom");
  });
  it("says why a home page could not be used instead of guessing", async () => {
    expect(await detectSchoolPlatform({ base: "" }, fake().getter)).toMatchObject({ platform: "unknown", problem: expect.stringMatching(/no athletics website/) });
    expect((await detectSchoolPlatform({ base: "https://a.edu" }, fake({ "https://a.edu/": { robots: true } }).getter)).problem).toMatch(/robots/);
    expect((await detectSchoolPlatform({ base: "https://a.edu" }, fake({ "https://a.edu/": { error: "ECONNRESET" } }).getter)).problem).toMatch(/unreachable/);
    expect((await detectSchoolPlatform({ base: "https://a.edu" }, fake().getter)).problem).toMatch(/HTTP 404/);
    expect(await detectSchoolPlatform({ base: "https://a.edu" }, fake({ "https://a.edu/": { body: fx("home_sidearm.html") } }).getter)).toEqual({ platform: "sidearm", problem: "" });
  });
});

describe("source parsers", () => {
  it("reads the NCAA directory in either shape, normalises the state and website, and skips rows with no name", () => {
    const json = JSON.parse(fx("ncaa_directory.json"));
    const list = parseNcaaDirectory(json);
    expect(list.map((s) => s.name)).toEqual(["Example College", "Sample University", "Presto State"]);
    expect(list[0]).toMatchObject({ state: "CT", conference: "NESCAC", base: "https://www.examplecollege.edu", ncaaId: "101" });
    expect(list[1]!.base).toBe("https://samplebobcats.com");
    expect(list[2]).toMatchObject({ state: "DE", base: "" }); // no website given: left empty, never invented
    expect(parseNcaaDirectory(json.data)).toHaveLength(3);
    expect(parseNcaaDirectory("nope")).toEqual([]);
    expect(parseNcaaDirectory({ error: "gone" })).toEqual([]);
  });
  it("reads a Wikipedia list: footnotes and daggers removed, state from the location column, other tables ignored", () => {
    const list = parseSchoolTables(fx("wikipedia_programs.html"));
    expect(list.map((s) => s.name)).toEqual(["Example College", "Wiki Only University", "Washington College"]);
    expect(list.map((s) => s.state)).toEqual(["CT", "MA", "MD"]);
    expect(list[0]!.conference).toBe("NESCAC");
    expect(list.every((s) => s.base === "")).toBe(true); // Wikipedia pages give no athletics site
  });
  it("reads an NJCAA table, taking a site from the link and a region as the conference", () => {
    const list = parseSchoolTables(fx("njcaa.html"));
    expect(list).toEqual([
      { name: "Example Community College", state: "NY", conference: "Region 3", base: "https://www.exampleccathletics.com" },
      { name: "Sample Junior College", state: "PA", conference: "Region 20", base: "" },
    ]);
    expect(parseSchoolTables("<p>no tables</p>")).toEqual([]);
  });
  it("reduces a website to its origin", () => {
    expect(siteOrigin("https://www.x.edu/athletics/home?a=1")).toBe("https://www.x.edu");
    expect(siteOrigin("x.edu")).toBe("https://x.edu");
    expect(siteOrigin("localhost")).toBe("");
    expect(siteOrigin(null)).toBe("");
  });
});

describe("collecting a division, with the Wikipedia fallback", () => {
  const cfg: SourcesConfig = {
    ncaa: { url: "https://ncaa.test/{sportCode}/{divisionCode}", sportCodes: { men: "MSO", women: "WSO" }, divisionCodes: { D3: 3 } },
    wikipedia: { D3: { men: "Men_Page", women: "Women_Page" } },
    njcaa: { men: ["https://njcaa.test/m"], women: ["https://njcaa.test/w"] },
  };
  const wiki = (t: string) => `https://en.wikipedia.org/w/index.php?title=${t}&action=render`;
  it("uses the official directory when it works, and records that as the source", async () => {
    const { getter } = fake({ "https://ncaa.test/MSO/3": { body: fx("ncaa_directory.json") } });
    const logs: string[] = [];
    const r = await collectTeam("D3", "men", cfg, getter, (l) => logs.push(l));
    expect(r.source).toBe("ncaa-directory");
    expect(r.schools).toHaveLength(3);
  });
  it("falls back to Wikipedia when the directory is unreachable, or has changed shape", async () => {
    const down = fake({ "https://ncaa.test/MSO/3": { status: 503 }, [wiki("Men_Page")]: { body: fx("wikipedia_programs.html") } });
    expect(await collectTeam("D3", "men", cfg, down.getter, () => undefined)).toMatchObject({ source: "wikipedia:Men_Page" });
    const changed = fake({ "https://ncaa.test/MSO/3": { body: '{"message":"new format"}' }, [wiki("Men_Page")]: { body: fx("wikipedia_programs.html") } });
    expect((await collectTeam("D3", "men", cfg, changed.getter, () => undefined)).source).toBe("wikipedia:Men_Page");
    const notJson = fake({ "https://ncaa.test/MSO/3": { body: "<html>maintenance</html>" }, [wiki("Men_Page")]: { body: fx("wikipedia_programs.html") } });
    expect((await collectTeam("D3", "men", cfg, notJson.getter, () => undefined)).source).toBe("wikipedia:Men_Page");
  });
  it("returns nothing, rather than inventing schools, when no source works", async () => {
    expect(await collectTeam("D3", "women", cfg, fake().getter, () => undefined)).toEqual({ schools: [], source: "" });
  });
  it("reads NJCAA from its own table", async () => {
    const r = await collectTeam("JUCO", "men", cfg, fake({ "https://njcaa.test/m": { body: fx("njcaa.html") } }).getter, () => undefined);
    expect(r.schools).toHaveLength(2);
    expect(r.source).toBe("njcaa:https://njcaa.test/m");
  });
  it("combines men's and women's lists; a team a source could not supply is unknown, not false", () => {
    const men = { schools: [{ name: "A College", state: "CT", conference: "C", base: "https://a.edu", division: "D3" }, { name: "B College", state: "NY", conference: "C", base: "", division: "D3" }], source: "ncaa-directory" };
    const women = { schools: [{ name: "A College", state: "CT", conference: "C", base: "", division: "D3" }], source: "wikipedia:W" };
    const both = combineTeams("D3", men, women);
    const a = both.find((s) => s.school === "A College")!;
    const b = both.find((s) => s.school === "B College")!;
    expect(a).toMatchObject({ men: true, women: true, base: "https://a.edu", state: "CT" });
    expect(a.source).toBe("men:ncaa-directory + women:wikipedia:W");
    expect(b).toMatchObject({ men: true, women: false });
    const noWomen = combineTeams("D3", men, { schools: [], source: "" });
    expect(noWomen.find((s) => s.school === "A College")!.women).toBeUndefined();
    expect(new Set(both.map((s) => s.id)).size).toBe(both.length);
  });
  it("gives two schools with the same name different ids", () => {
    const two = combineTeams("D3", { schools: [{ name: "Trinity College", state: "CT", conference: "", base: "", division: "D3" }, { name: "Trinity College", state: "TX", conference: "", base: "", division: "D3" }], source: "s" }, { schools: [], source: "" });
    expect(two.map((s) => s.id).sort()).toEqual(["trinity-college", "trinity-college-tx"].sort());
  });
});

describe("merging with existing lists and overrides", () => {
  const nescac: SchoolRecord = { id: "amherst", school: "Amherst College", division: "D3", conference: "NESCAC", base: "https://athletics.amherst.edu" };
  it("keeps existing entries exactly as they are and only fills in what they lack", () => {
    const incoming = combineTeams("D3", { schools: [{ name: "Amherst College", state: "MA", conference: "Other Conf", base: "https://other.example", division: "D3" }, { name: "New School", state: "NY", conference: "Z", base: "https://new.edu", division: "D3" }], source: "ncaa-directory" }, { schools: [], source: "" });
    const merged = mergeSchools([nescac], incoming);
    const am = merged.find((s) => s.school === "Amherst College")!;
    expect(am).toMatchObject({ id: "amherst", conference: "NESCAC", base: "https://athletics.amherst.edu", state: "MA", men: true });
    expect(merged.map((s) => s.school)).toEqual(["Amherst College", "New School"]);
    expect(nescac).toEqual({ id: "amherst", school: "Amherst College", division: "D3", conference: "NESCAC", base: "https://athletics.amherst.edu" }); // untouched object
  });
  it("matches by website host first, then by name, and adds the rest", () => {
    const merged = mergeSchools([nescac], [rec({ id: "x", school: "Amherst", base: "https://www.athletics.amherst.edu" }), rec({ id: "y", school: "AMHERST COLLEGE", base: "" })]);
    expect(merged).toHaveLength(1);
  });
  it("applies hand overrides by id or name, and can drop a school", () => {
    const out = applyOverrides([rec({ id: "a", school: "A", base: "" }), rec({ id: "b", school: "B" }), rec({ id: "c", school: "C" })], { a: { base: "https://a.example/home", platform: "sidearm" }, C: { skip: true } });
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ base: "https://a.example", platform: "sidearm" });
  });
});

describe("checking roster addresses", () => {
  const sid = (over = {}) => ({ base: "https://ex.edu", platform: "sidearm" as const, ...over });
  const url = (team: "men" | "women") => sidearmRosterUrl("https://ex.edu", team, 2025);
  it("builds the Sidearm pattern", () => {
    expect(url("men")).toBe("https://ex.edu/sports/mens-soccer/roster/2025");
    expect(url("women")).toBe("https://ex.edu/sports/womens-soccer/roster/2025");
  });
  it("verifies a school whose roster pages answer and parse, with exactly one request per program", async () => {
    const f = fake({ [url("men")]: { body: fx("list.html") }, [url("women")]: { body: fx("table.html") } });
    expect(await verifyRoster(sid(), f.getter, 2025, "now")).toMatchObject({ status: "verified", men: "found", women: "found" });
    expect(f.requests).toEqual([url("men"), url("women")]);
  });
  it("marks needs_review for a missing page, robots, a network error or an unreadable layout, and never tries another address", async () => {
    const f = fake({ [url("men")]: { body: fx("list.html") } });
    const missing = await verifyRoster(sid(), f.getter, 2025, "now");
    expect(missing).toMatchObject({ status: "needs_review", women: "not_found", reason: "women's roster page not found" });
    expect(f.requests).toEqual([url("men"), url("women")]); // nothing guessed
    expect(await verifyRoster(sid(), fake({ [url("men")]: { robots: true }, [url("women")]: { robots: true } }).getter, 2025, "n")).toMatchObject({ status: "needs_review", men: "blocked_by_robots" });
    expect(await verifyRoster(sid(), fake({ [url("men")]: { error: "ECONNRESET" }, [url("women")]: { body: fx("list.html") } }).getter, 2025, "n")).toMatchObject({ status: "needs_review", men: "error" });
    expect(await verifyRoster(sid(), fake({ [url("men")]: { body: "<html>hi</html>" }, [url("women")]: { body: fx("list.html") } }).getter, 2025, "n")).toMatchObject({ men: "unparsed" });
  });
  it("only checks the programs a school has", async () => {
    const f = fake({ [url("women")]: { body: fx("list.html") } });
    expect(await verifyRoster(sid({ men: false }), f.getter, 2025, "n")).toMatchObject({ status: "verified", men: "no_program", women: "found" });
    expect(f.requests).toEqual([url("women")]);
  });
  it("keeps other platforms in the list as unsupported_platform, with the pattern when it is simple", async () => {
    const f = fake();
    expect(await verifyRoster({ base: "https://cc.edu", platform: "prestosports" }, f.getter, 2025, "n")).toMatchObject({ status: "unsupported_platform", pattern: prestoRosterPattern("https://cc.edu") });
    expect(prestoRosterPattern("https://cc.edu/")).toBe("https://cc.edu/sports/{msoc|wsoc}/{season}-{yy}/roster");
    expect(await verifyRoster({ base: "https://w.edu", platform: "wmt" }, f.getter, 2025, "n")).toMatchObject({ status: "unsupported_platform" });
    expect(await verifyRoster({ base: "https://u.edu", platform: "unknown" }, f.getter, 2025, "n")).toMatchObject({ status: "unsupported_platform", reason: "platform not recognised" });
    expect(f.requests).toEqual([]);
  });
});

describe("enriching and building (fake network)", () => {
  const home = "https://ex.edu/";
  const site = (extra: Record<string, { body?: string; status?: number }> = {}) => ({
    [home]: { body: fx("home_sidearm.html") },
    "https://ex.edu/sports/mens-soccer/roster/2025": { body: fx("list.html") },
    "https://ex.edu/sports/womens-soccer/roster/2025": { body: fx("table.html") },
    ...extra,
  });

  it("detects the platform, then verifies, in one pass per school", async () => {
    const { getter, requests } = fake(site());
    const [s] = await enrichAll([rec()], getter, { season: 2025, nowIso: "now", concurrency: 1 });
    expect(s).toMatchObject({ platform: "sidearm", roster: { status: "verified" } });
    expect(requests).toHaveLength(3);
  });
  it("does not check again a school that is already done, but retries one that hit a network error", async () => {
    const done = rec({ platform: "sidearm", roster: { status: "verified", reason: "" } });
    const flaky = rec({ id: "f", platform: "unknown", roster: { status: "needs_review", reason: "home page unreachable (ECONNRESET)" } });
    const bad = rec({ id: "b", roster: { status: "needs_review", reason: "women's roster page not found" } });
    const { getter, requests } = fake(site());
    await enrichAll([done, bad, flaky], getter, { season: 2025, nowIso: "n", concurrency: 1 });
    expect(requests.every((u) => u.startsWith("https://ex.edu"))).toBe(true);
    expect(requests.length).toBe(3); // only the flaky school was looked at
  });
  it("--limit checks only that many schools", async () => {
    const { getter } = fake(site());
    const out = await enrichAll([rec({ id: "a" }), rec({ id: "b" }), rec({ id: "c" })], getter, { season: 2025, nowIso: "n", limit: 2, concurrency: 1 });
    expect(out.filter((s) => s.roster?.status === "verified").length).toBe(2);
    expect(out[2]!.roster!.status).toBe("unchecked");
  });

  it("builds every division's file, merges the hand-written NESCAC file without changing it, and picks up where it stopped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "schools-"));
    const nescacText = JSON.stringify({ schools: [{ id: "example", school: "Example College", division: "D3", conference: "NESCAC", base: "https://ex.edu" }] }, null, 1);
    writeFileSync(join(dir, "d3-nescac.json"), nescacText);
    const cfg: SourcesConfig = { ncaa: { url: "https://ncaa.test/{sportCode}/{divisionCode}", sportCodes: { men: "MSO", women: "WSO" }, divisionCodes: { D1: 1, D2: 2, D3: 3 } }, wikipedia: { D3: { men: "M", women: "W" } }, njcaa: { men: ["https://njcaa.test/m"], women: [] } };
    const dirJson = JSON.stringify({ data: [{ orgId: 1, division: 3, nameOfficial: "Example College", memberOrgAddress: { state: "CT" }, conferenceName: "NESCAC", athleticWebUrl: "https://ex.edu/x" }, { orgId: 2, division: 3, nameOfficial: "Presto College", memberOrgAddress: { state: "NY" }, conferenceName: "Z", athleticWebUrl: "https://presto.edu" }] });
    const net = fake({
      ...site(),
      "https://ncaa.test/MSO/3": { body: dirJson }, "https://ncaa.test/WSO/3": { body: dirJson },
      "https://ncaa.test/MSO/1": { status: 500 }, "https://ncaa.test/MSO/2": { status: 500 },
      "https://presto.edu/": { body: fx("home_presto.html") },
      "https://njcaa.test/m": { body: fx("njcaa.html") },
    });
    const logs: string[] = [];
    const opts = { dir, sources: cfg, overrides: {}, fetcher: net.getter, divisions: ["D1", "D3", "JUCO"] as const, season: 2025, nowIso: "now", log: (l: string) => logs.push(l) };
    const { schools: all } = await buildSchoolLists({ ...opts, divisions: [...opts.divisions] });

    expect(readFileSync(join(dir, "d3-nescac.json"), "utf8")).toBe(nescacText); // hand-written file untouched
    const d3 = JSON.parse(readFileSync(join(dir, "d3.json"), "utf8")).schools as SchoolRecord[];
    expect(d3.map((s) => s.id).sort()).toEqual(["example", "presto-college"]);
    expect(d3.find((s) => s.id === "example")).toMatchObject({ conference: "NESCAC", state: "CT", men: true, women: true, platform: "sidearm", roster: { status: "verified" } });
    expect(d3.find((s) => s.id === "presto-college")).toMatchObject({ platform: "prestosports", roster: { status: "unsupported_platform" } });
    expect(readFileSync(join(dir, "d1.json"), "utf8")).toContain('"schools": []');
    expect(logs.join("\n")).toMatch(/no source gave any D1 schools/);
    expect(JSON.parse(readFileSync(join(dir, "juco.json"), "utf8")).schools).toHaveLength(2);
    expect(all.filter((s) => s.division === "JUCO").every((s) => s.women === undefined)).toBe(true); // no women's list could be read

    // The merged lists load without duplicates (the NESCAC file wins, d3.json fills the rest).
    expect(loadSchoolFiles(dir).filter((s) => s.id === "example")).toHaveLength(1);

    // A second run costs nothing and changes nothing.
    const before = net.requests.length;
    const { schools: again } = await buildSchoolLists({ ...opts, divisions: [...opts.divisions] });
    expect(again.map((s) => [s.id, s.roster?.status])).toEqual(all.map((s) => [s.id, s.roster?.status]));
    const newRequests = net.requests.slice(before).filter((u) => !u.startsWith("https://ncaa.test") && !u.startsWith("https://njcaa.test"));
    expect(newRequests).toEqual([]);
  });
});

describe("reports", () => {
  const list: SchoolRecord[] = [
    rec({ id: "1", school: "One", platform: "sidearm", men: true, women: true, roster: { status: "verified", reason: "" } }),
    rec({ id: "2", school: "Two", platform: "prestosports", men: true, women: false, roster: { status: "unsupported_platform", reason: "PrestoSports roster pages are not read yet" }, source: "men:ncaa-directory" }),
    rec({ id: "3", school: "Three", platform: "prestosports", men: true, women: true, roster: { status: "unsupported_platform", reason: "x" } }),
    rec({ id: "4", school: "Four", platform: "sidearm", division: "D1", men: false, women: true, roster: { status: "needs_review", reason: "men's roster page not found" } }),
    rec({ id: "5", school: "Five", platform: "unknown", roster: { status: "needs_review", reason: "home page unreachable (ECONNRESET)" } }),
    rec({ id: "6", school: "Six", platform: "unknown", base: "", roster: { status: "needs_review", reason: "no athletics website address (add it in schools/overrides.json)" } }),
  ];
  it("counts schools, programs, platforms, address status and the biggest problem groups", () => {
    const text = schoolReport(list).join("\n");
    expect(text).toMatch(/D3: 5 schools, 3 men's programs, 2 women's programs/);
    expect(text).toMatch(/D1: 1 schools, 0 men's programs, 1 women's programs/);
    expect(text).toMatch(/PrestoSports: 2/);
    expect(text).toMatch(/Roster addresses: verified 1, needs_review 3, unsupported_platform 2, unchecked 0/);
    expect(text).toMatch(/PrestoSports sites: 2/);
    expect(text).toMatch(/roster page not found: 1/);
    expect(text).toMatch(/site unreachable \/ network error: 1/);
    expect(text).toMatch(/no athletics website address: 1/);
    expect(text).toMatch(/ncaa-directory/);
  });
  it("groups problems", () => {
    expect(list.map(problemGroup)).toEqual([null, "PrestoSports sites", "PrestoSports sites", "roster page not found", "site unreachable / network error", "no athletics website address"]);
  });
  it("lists schools needing review with the reason and no player data", () => {
    const lines = needsReviewLines(list);
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe("Four | D1 | needs_review: men's roster page not found");
    expect(needsReviewLines(list, "D1")).toEqual(["Four | D1 | needs_review: men's roster page not found"]);
  });
  it("--list-needs-review prints from the list files without any network or email", () => {
    const dir = mkdtempSync(join(tmpdir(), "schools-"));
    writeFileSync(join(dir, "d3.json"), JSON.stringify({ schools: list.filter((s) => s.division === "D3") }));
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--list-needs-review", "--schools", dir, "--out", mkdtempSync(join(tmpdir(), "o-"))], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "" } });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Two \| D3 \| unsupported_platform: PrestoSports roster pages are not read yet/);
    expect(res.stdout).toMatch(/Five \| D3 \| needs_review: home page unreachable/);
    expect(res.stdout).toMatch(/4 schools need review/);
  });
});

describe("phase planning", () => {
  const schools: School[] = [
    { id: "a", school: "A", division: "D3", conference: "X", base: "https://a.edu", state: "CT", men: true, women: true, platform: "sidearm", roster: { status: "verified", reason: "" } },
    { id: "b", school: "B", division: "D3", conference: "X", base: "https://b.edu", state: "NY", men: true, women: false, platform: "sidearm", roster: { status: "unchecked", reason: "" } },
    { id: "c", school: "C", division: "D2", conference: "X", base: "https://c.edu", state: "CT", men: true, women: true, platform: "prestosports", roster: { status: "unsupported_platform", reason: "PrestoSports roster pages are not read yet" } },
    { id: "d", school: "D", division: "D2", conference: "X", base: "https://d.edu", state: "CT", men: true, women: true, platform: "sidearm", roster: { status: "needs_review", reason: "women's roster page not found" } },
    { id: "e", school: "E", division: "JUCO", conference: "X", base: "", state: "NY" },
    { id: "f", school: "F", division: "D1", conference: "X", base: "https://f.edu", state: "CT", men: true, women: true, platform: "sidearm", roster: { status: "verified", reason: "" } },
  ];
  it("fetches verified and Sidearm-pattern schools only, skips the rest with a reason, and skips programs a school doesn't have", () => {
    const p = planWithSkips(schools, { divisions: ["D3", "D2", "JUCO"], seasons: [2026] });
    expect(p.tasks.map((t) => `${t.school.id}|${t.team}`)).toEqual(["a|men", "a|women", "b|men"]); // b has no women's program: not planned at all
    expect(p.skipped.map((k) => `${k.school}|${k.team}|${k.reason.split(":")[0]}`)).toEqual(["C|men|unsupported_platform", "C|women|unsupported_platform", "D|men|needs_review", "D|women|needs_review", "E|men|no athletics website address", "E|women|no athletics website address"]);
    expect(skipReason(schools[3]!)).toMatch(/women's roster page not found/);
    expect(skipReason({ ...schools[0]!, roster: undefined, platform: undefined })).toBeNull(); // a hand-written entry is assumed to be Sidearm
  });
  it("filters by division and by the school's state", () => {
    expect(planWithSkips(schools, { divisions: ["D3", "D2"], seasons: [2026], state: "ct" }).tasks.map((t) => t.school.id)).toEqual(["a", "a"]);
    expect(planWithSkips(schools, { divisions: ["D1"], seasons: [2022, 2018, 2014] }).tasks).toHaveLength(6); // 2 teams x 3 seasons
  });
  it("puts the skipped programs in the coverage log with their reason", () => {
    const p = planWithSkips(schools, { divisions: ["D2"], seasons: [2026] });
    const csv = coverageCsvWithSkips([], p.skipped).trim().split("\n");
    expect(csv[0]).toMatch(/^school,division,conference,team,season,status/);
    expect(csv[1]).toContain("skipped");
    expect(csv[1]).toContain("PrestoSports roster pages are not read yet");
  });
  it("tries the live site first, then Wayback, for seasons before 2025 only", () => {
    const t = (season: number): Task => ({ school: schools[0]!, team: "men", season });
    expect(candidateUrls(t(2025)).some((u) => u.includes("web.archive.org"))).toBe(false);
    const old = candidateUrls(t(2022));
    expect(old[0]).toBe("https://a.edu/sports/mens-soccer/roster/2022");
    expect(old.findIndex((u) => u.includes("web.archive.org"))).toBeGreaterThan(old.indexOf("https://a.edu/sports/mens-soccer/roster/2022-23"));
  });
});

describe("polite fetching: Wayback pace, timeout, one request at a time per host", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "roster-"));
  it("waits 2 seconds between Wayback requests and 1 second elsewhere", async () => {
    const sleeps: number[] = [];
    let now = 5_000_000;
    const f = new PoliteFetcher({ cacheDir: dir(), userAgent: "UA", now: () => now, sleep: async (ms) => void (sleeps.push(ms), (now += ms)), fetchImpl: async () => ({ status: 200, text: async () => "x" }) });
    await f.get("https://web.archive.org/web/20220101/https://a.edu/p1");
    await f.get("https://web.archive.org/web/20220101/https://a.edu/p2");
    expect(sleeps.filter((s) => s === 2000).length).toBeGreaterThanOrEqual(2); // robots + page, page + page
    expect(sleeps.every((s) => s === 2000)).toBe(true);
  });
  it("reports a timeout as a retryable error that is not cached", async () => {
    let n = 0;
    const f = new PoliteFetcher({ cacheDir: dir(), userAgent: "UA", timeoutMs: 30_000, sleep: async () => undefined, fetchImpl: (async () => { n++; if (n === 2) throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); return { status: 200, text: async () => "ok" }; }) as FetchLike });
    const first = await f.get("https://a.example.edu/p"); // n=1 is robots, n=2 the page
    expect(first).toMatchObject({ status: 0, error: "timeout after 30s" });
    expect(await f.get("https://a.example.edu/p")).toMatchObject({ status: 200 });
  });
  it("never lets two workers hit one host together", async () => {
    let now = 0;
    const starts: number[] = [];
    const f = new PoliteFetcher({ cacheDir: dir(), userAgent: "UA", now: () => now, sleep: async (ms) => void (now += ms), fetchImpl: async () => { starts.push(now); return { status: 200, text: async () => "x" }; } });
    await Promise.all(["a", "b", "c", "d"].map((p) => f.get(`https://a.example.edu/${p}`)));
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(gaps.every((g) => g >= 1000)).toBe(true);
  });
});

describe("repo hygiene for the school lists", () => {
  it("the seed files are valid JSON and the list files carry no player data", () => {
    for (const f of ["sources.json", "overrides.json", "d3-nescac.json"]) JSON.parse(readFileSync(new URL(`../scripts/roster-research/schools/${f}`, import.meta.url), "utf8"));
    const src = readFileSync(new URL("../scripts/roster-research/schoolList.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/hometown|class_year|player/i);
  });
});
