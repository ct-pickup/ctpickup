import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Getter } from "../scripts/roster-research/core";
import { describeNcaa, debugNcaaCache, fieldPaths } from "../scripts/roster-research/debugSource";
import { PoliteFetcher } from "../scripts/roster-research/fetcher";
import { buildSchoolLists, combineTeamsWithStats, collectTeam, curatedIds, loadSchoolFiles, type SchoolRecord, type SourcesConfig } from "../scripts/roster-research/schoolList";
import { normalizeDivision, parseNcaaDirectory, soccerTeams } from "../scripts/roster-research/sources";

const fx = (n: string) => readFileSync(new URL(`./fixtures/roster/${n}`, import.meta.url), "utf8");
const mixed = fx("ncaa_mixed.json");

function fake(map: Record<string, { status?: number; body?: string }>) {
  const requests: string[] = [];
  const getter: Getter = {
    get: async (url) => {
      requests.push(url);
      const r = map[url];
      return r ? { url, status: r.status ?? 200, body: r.body ?? "", fromCache: false } : { url, status: 404, body: "", fromCache: false };
    },
  };
  return { getter, requests };
}

const cfg: SourcesConfig = { ncaa: { url: "https://ncaa.test/{sportCode}/{divisionCode}", sportCodes: { men: "MSO", women: "WSO" }, divisionCodes: { D1: 1, D2: 2, D3: 3 } } };
/** A directory that ignores the division and sport in the request: every call returns every row. */
const ignoresParams = () => fake({ "https://ncaa.test/MSO/3": { body: mixed }, "https://ncaa.test/WSO/3": { body: mixed }, "https://ncaa.test/MSO/1": { body: mixed }, "https://ncaa.test/WSO/1": { body: mixed } });

describe("reading a school's own division", () => {
  it.each([
    ["III", "D3"], ["Division III", "D3"], ["NCAA Division III", "D3"], [3, "D3"], ["3", "D3"], ["D3", "D3"], ["DIII", "D3"], [{ name: "Division III", code: 3 }, "D3"],
    ["II", "D2"], ["Division II", "D2"], [2, "D2"], ["I", "D1"], ["Division I", "D1"], ["Division I FBS", "D1"], ["Division I-FCS", "D1"], [1, "D1"],
    ["", ""], [null, ""], ["NAIA", ""], ["Big 12", ""], [{}, ""],
  ] as const)("%j -> %j", (raw, want) => {
    expect(normalizeDivision(raw)).toBe(want);
  });
  it("reads soccer programs from codes and names", () => {
    expect(soccerTeams(["MSO"])).toEqual(["men"]);
    expect(soccerTeams(["WSO", "Football"])).toEqual(["women"]);
    expect(soccerTeams(["Men's Soccer", "Women's Soccer"]).sort()).toEqual(["men", "women"]);
    expect(soccerTeams(["Women's Soccer"])).toEqual(["women"]);
    expect(soccerTeams(["Football", "Men's Basketball"])).toEqual([]);
  });
  it("the directory parser keeps each row's own division, sport and school id", () => {
    const rows = parseNcaaDirectory(JSON.parse(mixed));
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ name: "Example College", division: "D3", teams: ["men"], ncaaId: "1" });
    expect(rows[3]).toMatchObject({ division: "D1", teams: ["women"] });
    expect(rows[5]).toMatchObject({ name: "Mystery University", division: "" }); // no division field: unknown
    expect(rows[7]).toMatchObject({ division: "D3", teams: ["men", "women"] });
    expect(rows[8]).toMatchObject({ division: "D3", teams: [] }); // sports listed, none of them soccer
  });
});

describe("only schools of the division being built", () => {
  it("keeps the D3 schools once each, with men's and women's merged, even when the directory returns every division", () => {
    const rows = parseNcaaDirectory(JSON.parse(mixed));
    const { records } = combineTeamsWithStats("D3", { schools: rows, source: "ncaa-directory" }, { schools: rows, source: "ncaa-directory" });
    expect(records.map((r) => r.school).sort()).toEqual(["Example College", "Nested Division College", "No Id Example", "Numeric Division College"]);
    const by = Object.fromEntries(records.map((r) => [r.school, r]));
    expect(by["Example College"]).toMatchObject({ men: true, women: true, division: "D3", state: "CT", conference: "NESCAC", base: "https://www.examplecollege.edu" });
    expect(by["Nested Division College"]).toMatchObject({ men: true, women: false });
    expect(by["Numeric Division College"]).toMatchObject({ men: true, women: true });
    expect(by["No Id Example"]).toMatchObject({ men: true, women: true, base: "https://noid.edu", state: "MA" }); // merged by name+state despite a missing id and website on one row
    for (const r of records) {
      expect(r.name).toBe(r.school); // the display name is saved as `name`
      expect(["D3"]).toContain(r.division);
    }
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    expect(records.map((r) => r.conference)).not.toContain("Big 12");
    expect(records.map((r) => r.conference)).not.toContain("SEC");
    expect(records.map((r) => r.conference)).not.toContain("Lone Star");
  });
  it("counts what it dropped: other divisions, division unknown, and no soccer program", () => {
    const rows = parseNcaaDirectory(JSON.parse(mixed));
    const { stats } = combineTeamsWithStats("D3", { schools: rows, source: "s" }, { schools: rows, source: "s" });
    expect(stats.otherDivisionSchools).toBe(3); // Big State, Lone Star, FBS Giant
    expect(stats.otherDivisionRows).toBe(2 * 4); // rows seen in both lists
    expect(stats.divisionUnknownSchools).toBe(1); // Mystery University
    expect(stats.divisionUnknownRows).toBe(2);
    expect(stats.notSoccerRows).toBe(2); // Football Only College, seen in both lists
  });
  it("builds D1 from the same responses without any D3 or D2 school", () => {
    const rows = parseNcaaDirectory(JSON.parse(mixed));
    const { records } = combineTeamsWithStats("D1", { schools: rows, source: "s" }, { schools: rows, source: "s" });
    expect(records.map((r) => r.school).sort()).toEqual(["Big State University", "FBS Giant"]);
    expect(combineTeamsWithStats("D2", { schools: rows, source: "s" }, { schools: rows, source: "s" }).records.map((r) => r.school)).toEqual(["Lone Star College"]);
  });
  it("a row without a division is dropped, never assigned the request's division", () => {
    const only = [{ name: "No Division U", state: "NY", conference: "", base: "", teams: ["men" as const] }];
    const { records, stats } = combineTeamsWithStats("D3", { schools: only, source: "s" }, { schools: [], source: "" });
    expect(records).toEqual([]);
    expect(stats.divisionUnknownSchools).toBe(1);
  });
  it("trusts a division-specific source (a Wikipedia list for one division) because the page itself names the division", async () => {
    const wikiCfg: SourcesConfig = { wikipedia: { D3: { men: "M", women: "W" } } };
    const f = fake({ "https://en.wikipedia.org/w/index.php?title=M&action=render": { body: fx("wikipedia_programs.html") } });
    const men = await collectTeam("D3", "men", wikiCfg, f.getter, () => undefined);
    expect(men.schools.every((s) => s.division === "D3")).toBe(true);
    expect(combineTeamsWithStats("D3", men, { schools: [], source: "" }).records).toHaveLength(3);
  });
  it("merges one school across rows by website host, else name and state; the same name in another state stays separate", () => {
    const base = { conference: "", division: "D3", teams: ["men" as const] };
    const rows = [
      { ...base, name: "Alpha College", state: "NY", base: "https://www.alpha.edu" },
      { ...base, name: "Alpha Coll.", state: "NY", base: "https://alpha.edu", teams: ["women" as const] }, // same host
      { ...base, name: "Beta College", state: "CT", base: "" },
      { ...base, name: "Beta College", state: "CT", base: "", teams: ["women" as const] }, // same name+state
      { ...base, name: "Beta College", state: "TX", base: "" }, // another school
    ];
    const { records } = combineTeamsWithStats("D3", { schools: rows, source: "s" }, { schools: [], source: "" });
    expect(records).toHaveLength(3);
    expect(records.find((r) => r.school === "Alpha College")).toMatchObject({ men: true, women: true });
    expect(records.filter((r) => r.school === "Beta College").map((r) => r.state).sort()).toEqual(["CT", "TX"]);
  });
});

describe("rebuilding over the bad 1034-school list", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "schools-"));
  const nescac = { schools: [{ id: "example", school: "Example College", division: "D3", conference: "NESCAC", base: "https://www.examplecollege.edu" }] };

  function seedBad(d: string, withNescac = true) {
    const bad: SchoolRecord[] = [
      { id: "big-state-university", name: "Big State University", school: "Big State University", division: "D3", conference: "Big 12", base: "https://bigstate.edu", state: "TX", men: true, women: true, platform: "sidearm", source: "men:ncaa-directory", roster: { status: "verified", reason: "" } },
      { id: "lone-star-college", name: "Lone Star College", school: "Lone Star College", division: "D3", conference: "Lone Star", base: "https://lonestar.edu", state: "TX", platform: "sidearm", source: "women:ncaa-directory", roster: { status: "verified", reason: "" } },
      { id: "example", name: "Example College", school: "Example College", division: "D3", conference: "NESCAC", base: "https://www.examplecollege.edu", source: "men:ncaa-directory", platform: "sidearm", roster: { status: "verified", reason: "" } },
      { id: "hand-added", school: "Hand Added College", division: "D3", conference: "Z", base: "https://hand.edu" } as SchoolRecord, // no source: someone typed it
    ];
    writeFileSync(join(d, "d3.json"), JSON.stringify({ schools: bad }));
    if (withNescac) writeFileSync(join(d, "d3-nescac.json"), JSON.stringify(nescac, null, 1));
  }
  const opts = (d: string, f: Getter) => ({ dir: d, sources: cfg, overrides: {}, fetcher: f, divisions: ["D3" as const], season: 2025, nowIso: "n", listsOnly: true, log: () => undefined });

  it("removes the other-division entries an earlier build wrote, keeps hand-written ones, and leaves d3-nescac.json byte for byte", async () => {
    const d = dir();
    seedBad(d);
    const before = readFileSync(join(d, "d3-nescac.json"), "utf8");
    const { schools, stats } = await buildSchoolLists(opts(d, ignoresParams().getter));
    const names = schools.filter((s) => s.division === "D3").map((s) => s.school).sort();
    expect(names).toEqual(["Example College", "Hand Added College", "Nested Division College", "No Id Example", "Numeric Division College"]);
    expect(stats.staleRemoved).toBe(2);
    expect(readFileSync(join(d, "d3-nescac.json"), "utf8")).toBe(before);
    const d3 = JSON.parse(readFileSync(join(d, "d3.json"), "utf8")).schools as { id: string; name: string; school: string }[];
    expect(d3.every((s) => s.name === s.school && !!s.name)).toBe(true); // `name` is on every entry
    expect(loadSchoolFiles(d).filter((s) => s.id === "example")).toHaveLength(1);
    expect(curatedIds(d).has("example")).toBe(true);
  });
  it("never removes anything when the source gave nothing (a failed fetch must not wipe the list)", async () => {
    const d = dir();
    seedBad(d);
    const { schools, stats } = await buildSchoolLists(opts(d, fake({}).getter));
    expect(schools.filter((s) => s.division === "D3")).toHaveLength(4); // the 4 seeded entries, untouched
    expect(stats.staleRemoved).toBe(0);
  });
  it("--lists-only makes no home-page or roster requests", async () => {
    const d = dir();
    const net = ignoresParams();
    await buildSchoolLists(opts(d, net.getter));
    expect(net.requests.every((u) => u.startsWith("https://ncaa.test"))).toBe(true);
  });
  it("a hand-written entry survives even if a source stops listing it", async () => {
    const d = dir();
    writeFileSync(join(d, "d3-nescac.json"), JSON.stringify({ schools: [{ id: "curated", school: "Curated College", division: "D3", conference: "NESCAC", base: "https://curated.edu", source: "typed" }] }));
    const { schools } = await buildSchoolLists(opts(d, ignoresParams().getter));
    expect(schools.some((s) => s.id === "curated")).toBe(true);
  });
});

describe("--debug-source ncaa", () => {
  it("describes field names, division and sport values with counts, distinct ids and 5 samples", () => {
    const text = describeNcaa(JSON.parse(mixed), "https://ncaa.test/MSO/3").join("\n");
    expect(text).toMatch(/12 records/);
    expect(text).toMatch(/memberOrgAddress\.state \(string\)/);
    expect(text).toMatch(/nameOfficial \(string\)/);
    expect(text).toMatch(/division = "III"/);
    expect(text).toMatch(/\s2\s+division = "III"/);
    expect(text).toMatch(/division = "I"/);
    expect(text).toMatch(/sportCode = "MSO"/);
    expect(text).toMatch(/sports = "Football"/);
    expect(text).toMatch(/Distinct school ids: 8/);
    expect(text).toMatch(/Distinct name\+state: 9/);
    expect(text).toMatch(/Division as the parser reads it: D3 \d+, D1 \d+/);
    const samples = text.split("5 sample records")[1]!.trim().split("\n").slice(1).filter((l) => l.startsWith("  "));
    expect(samples).toHaveLength(5);
    expect(samples.join("\n")).not.toMatch(/hometown|class_year|player/i);
  });
  it("handles a response that is not a list", () => {
    expect(describeNcaa({ message: "moved" }, "u").join("\n")).toMatch(/not a list of records.*message/);
    expect(fieldPaths({ a: 1, b: { c: "x" } }).sort()).toEqual(["a (number)", "b.c (string)"]);
  });
  it("reads only the cached pages, with no network, through run.ts", async () => {
    const out = mkdtempSync(join(tmpdir(), "roster-out-"));
    const cache = join(out, ".cache");
    // Put a response in the cache exactly as the fetcher does.
    const f = new PoliteFetcher({ cacheDir: cache, userAgent: "UA", sleep: async () => undefined, fetchImpl: async (url) => ({ status: url.endsWith("robots.txt") ? 404 : 200, text: async () => (url.endsWith("robots.txt") ? "" : mixed) }) });
    await f.get("https://web3.ncaa.org/directory/api/directory/memberList?type=12&sportCode=MSO&division=3");
    expect(debugNcaaCache(cache, "web3.ncaa.org").join("\n")).toMatch(/memberList\?type=12&sportCode=MSO&division=3: 12 records/);
    const sch = mkdtempSync(join(tmpdir(), "schools-"));
    mkdirSync(sch, { recursive: true });
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--debug-source", "ncaa", "--out", out, "--schools", sch], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "" } });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/12 records/);
    expect(res.stdout).toMatch(/Distinct school ids: 8/);
    expect(debugNcaaCache(join(out, "nothing"), "web3.ncaa.org")[0]).toMatch(/No cached pages/);
  });
});
