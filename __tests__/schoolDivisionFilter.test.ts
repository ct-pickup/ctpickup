import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Getter } from "../scripts/roster-research/core";
import { describeNcaa, debugNcaaCache, fieldPaths } from "../scripts/roster-research/debugSource";
import { PoliteFetcher } from "../scripts/roster-research/fetcher";
import { buildSchoolLists, combineTeamsWithStats, collectTeam, curatedIds, loadSchoolFiles, schoolReport, type SchoolRecord, type SourcesConfig } from "../scripts/roster-research/schoolList";
import { isDeactivated, normalizeDivision, parseNcaaDirectory, soccerTeams } from "../scripts/roster-research/sources";

const fx = (n: string) => readFileSync(new URL(`./fixtures/roster/${n}`, import.meta.url), "utf8");
const mso = fx("ncaa_real_mso.json");
const wso = fx("ncaa_real_wso.json");

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
const ignoresParams = () => fake({ "https://ncaa.test/MSO/3": { body: mso }, "https://ncaa.test/WSO/3": { body: wso }, "https://ncaa.test/MSO/1": { body: mso }, "https://ncaa.test/WSO/1": { body: wso } });
const parsed = (body: string) => parseNcaaDirectory(JSON.parse(body));
const combine = (d: "D1" | "D2" | "D3") => combineTeamsWithStats(d, { schools: parsed(mso), source: "ncaa-directory" }, { schools: parsed(wso), source: "ncaa-directory" });

describe("reading a school's own division", () => {
  it.each([
    ["III", "D3"], ["Division III", "D3"], ["NCAA Division III", "D3"], [3, "D3"], ["3", "D3"], ["D3", "D3"], ["DIII", "D3"], [{ name: "Division III", code: 3 }, "D3"],
    ["II", "D2"], ["Division II", "D2"], [2, "D2"], ["I", "D1"], ["Division I", "D1"], ["Division I FBS", "D1"], ["Division I-FCS", "D1"], [1, "D1"],
    ["", ""], [null, ""], ["NAIA", ""], ["Big 12", ""], [{}, ""],
  ] as const)("%j -> %j", (raw, want) => {
    expect(normalizeDivision(raw)).toBe(want);
  });
  it("reads soccer programs from codes and names (for sources that really carry a sport field)", () => {
    expect(soccerTeams(["MSO"])).toEqual(["men"]);
    expect(soccerTeams(["WSO", "Football"])).toEqual(["women"]);
    expect(soccerTeams(["Men's Soccer", "Women's Soccer"]).sort()).toEqual(["men", "women"]);
    expect(soccerTeams(["Women's Soccer"])).toEqual(["women"]);
    expect(soccerTeams(["Football", "Men's Basketball"])).toEqual([]);
  });
  it("reads the deactive flag: only a clear 'active' value keeps a school", () => {
    for (const v of ["N", "No", "false", false, 0, "", null, undefined, "null", "active"]) expect(isDeactivated(v), String(v)).toBe(false);
    for (const v of ["Y", "yes", "true", true, 1, "2019-06-30"]) expect(isDeactivated(v), String(v)).toBe(true);
  });
  it("the directory parser reads the real record shape: orgId, nameOfficial, numeric division, no sport", () => {
    const rows = parsed(mso);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ name: "Example College", division: "D3", ncaaId: "1", state: "CT", conference: "NESCAC", base: "https://www.examplecollege.edu", deactivated: false, provisional: false });
    expect(rows[0]!.teams).toBeUndefined(); // sportRegion is a region, never a sport
    expect(rows[1]).toMatchObject({ division: "D1" });
    expect(rows[2]).toMatchObject({ name: "Emerald State", base: "https://www.emeraldstate.edu" }); // athleticWebUrl empty: falls back to webSiteUrl
    expect(rows[3]).toMatchObject({ deactivated: true });
    expect(rows[5]).toMatchObject({ name: "No Division University", division: "" });
    expect(parsed(wso)[4]).toMatchObject({ name: "Provisional Tech", provisional: true, deactivated: false });
  });
});

describe("only schools of the division being built", () => {
  it("an MSO response with D1, D2 and D3 rows yields the D3 ones with men=true, women=false; the WSO response sets women=true", () => {
    const menOnly = combineTeamsWithStats("D3", { schools: parsed(mso), source: "s" }, { schools: [], source: "" }).records;
    expect(menOnly.map((r) => r.school).sort()).toEqual(["Emerald State", "Example College"]);
    for (const r of menOnly) expect(r).toMatchObject({ men: true, division: "D3" });
    expect(menOnly.every((r) => r.women !== true)).toBe(true);
    const { records } = combine("D3");
    const by = Object.fromEntries(records.map((r) => [r.school, r]));
    expect(Object.keys(by).sort()).toEqual(["Emerald State", "Example College", "Provisional Tech", "Women Only"]);
    expect(by["Example College"]).toMatchObject({ men: true, women: true, ncaa_id: "1", state: "CT", conference: "NESCAC", base: "https://www.examplecollege.edu" });
    expect(by["Emerald State"]).toMatchObject({ men: true, women: false });
    expect(by["Women Only"]).toMatchObject({ men: false, women: true });
    expect(by["Provisional Tech"]).toMatchObject({ men: false, women: true, provisional: true });
    expect(by["Example College"]!.provisional).toBeUndefined();
    for (const r of records) {
      expect(r.name).toBe(r.school);
      expect(r.division).toBe("D3");
    }
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
  });
  it("drops deactivated schools, other divisions and unreadable divisions, and never drops a row for 'no soccer program'", () => {
    const { records, stats } = combine("D3");
    expect(records.map((r) => r.school)).not.toContain("Closed College");
    expect(stats.deactivatedRows).toBe(2); // once in each response
    expect(stats.otherDivisionSchools).toBe(3); // Big State, FBS Giant, Lone Star
    expect(stats.otherDivisionRows).toBe(4);
    expect(stats.divisionUnknownSchools).toBe(1);
    expect(stats.divisionUnknownRows).toBe(1);
    expect(stats.notSoccerRows).toBe(0);
  });
  it("builds D1 and D2 from the same responses without any D3 school", () => {
    expect(combine("D1").records.map((r) => r.school).sort()).toEqual(["Big State University", "FBS Giant"]);
    const d2 = combine("D2").records;
    expect(d2.map((r) => r.school)).toEqual(["Lone Star College"]);
    expect(d2[0]).toMatchObject({ men: false, women: true });
    expect(combine("D1").records.find((r) => r.school === "Big State University")).toMatchObject({ men: true, women: true });
  });
  it("different orgIds never merge, even with the same website or name; the same orgId always does", () => {
    const row = (id: string, name: string, base: string) => ({ name, state: "NY", conference: "", base, division: "D3", ncaaId: id });
    const { records } = combineTeamsWithStats("D3", { schools: [row("1", "Twin College", "https://twin.edu"), row("2", "Twin College", "https://twin.edu")], source: "s" }, { schools: [row("1", "Twin College (renamed)", "")], source: "s" });
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.ncaa_id === "1")).toMatchObject({ men: true, women: true });
  });
  it("a row without a division is dropped, never assigned the request's division", () => {
    const only = [{ name: "No Division U", state: "NY", conference: "", base: "" }];
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
  it("a source row that lists its sports but none is soccer is still dropped (sources that really carry a sport field)", () => {
    const rows = [{ name: "Football U", state: "PA", conference: "", base: "", division: "D3", teams: [] as ("men" | "women")[] }];
    const { records, stats } = combineTeamsWithStats("D3", { schools: rows, source: "s" }, { schools: [], source: "" });
    expect(records).toEqual([]);
    expect(stats.notSoccerRows).toBe(1);
  });
  it("merges one school across rows by website host, else name and state; the same name in another state stays separate", () => {
    const base = { conference: "", division: "D3", teams: ["men" as const] };
    const rows = [
      { ...base, name: "Alpha College", state: "NY", base: "https://www.alpha.edu" },
      { ...base, name: "Alpha Coll.", state: "NY", base: "https://alpha.edu", teams: ["women" as const] },
      { ...base, name: "Beta College", state: "CT", base: "" },
      { ...base, name: "Beta College", state: "CT", base: "", teams: ["women" as const] },
      { ...base, name: "Beta College", state: "TX", base: "" },
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
      { id: "hand-added", school: "Hand Added College", division: "D3", conference: "Z", base: "https://hand.edu" } as SchoolRecord,
    ];
    writeFileSync(join(d, "d3.json"), JSON.stringify({ schools: bad }));
    if (withNescac) writeFileSync(join(d, "d3-nescac.json"), JSON.stringify(nescac, null, 1));
  }
  const opts = (d: string, f: Getter) => ({ dir: d, sources: cfg, overrides: {}, fetcher: f, divisions: ["D3" as const], season: 2025, nowIso: "n", listsOnly: true, log: () => undefined });

  it("replaces the earlier list: other-division entries go, hand-written ones stay, and d3-nescac.json is byte for byte unchanged", async () => {
    const d = dir();
    seedBad(d);
    const before = readFileSync(join(d, "d3-nescac.json"), "utf8");
    const { schools, stats } = await buildSchoolLists(opts(d, ignoresParams().getter));
    const names = schools.filter((s) => s.division === "D3").map((s) => s.school).sort();
    expect(names).toEqual(["Emerald State", "Example College", "Hand Added College", "Provisional Tech", "Women Only"]);
    expect(stats.staleRemoved).toBe(2);
    expect(readFileSync(join(d, "d3-nescac.json"), "utf8")).toBe(before);
    const d3 = JSON.parse(readFileSync(join(d, "d3.json"), "utf8")).schools as { id: string; name: string; school: string }[];
    expect(d3.every((s) => s.name === s.school && !!s.name)).toBe(true);
    expect(loadSchoolFiles(d).filter((s) => s.id === "example")).toHaveLength(1);
    expect(curatedIds(d).has("example")).toBe(true);
  });
  it("never removes anything when the source gave nothing (a failed fetch must not wipe the list)", async () => {
    const d = dir();
    seedBad(d);
    const { schools, stats } = await buildSchoolLists(opts(d, fake({}).getter));
    expect(schools.filter((s) => s.division === "D3")).toHaveLength(4);
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
  it("the report prints schools, men's, women's and both per division", () => {
    const { records } = combine("D3");
    const line = schoolReport(records).find((l) => l.startsWith("D3:"))!;
    expect(line).toMatch(/^D3: 4 schools, 2 men's programs, 3 women's programs, 1 schools with both/);
  });
});

describe("--debug-source ncaa", () => {
  it("describes field names, division and sport-like values, deactive/provisional values, distinct ids and 5 samples", () => {
    const text = describeNcaa(JSON.parse(mso), "https://ncaa.test/MSO/3").join("\n");
    expect(text).toMatch(/6 records/);
    expect(text).toMatch(/memberOrgAddress\.state \(string\)/);
    expect(text).toMatch(/nameOfficial \(string\)/);
    expect(text).toMatch(/\s2\s+division = 1\b/);
    expect(text).toMatch(/\s3\s+division = 3\b/);
    expect(text).toMatch(/sportRegion = "EAST REGION"/);
    expect(text).toMatch(/deactive = "N"/);
    expect(text).toMatch(/deactive = "Y"/);
    expect(text).toMatch(/provisionalMember = false/);
    expect(text).toMatch(/As parsed: 1 deactivated, 0 provisional/);
    expect(text).toMatch(/Distinct school ids: 6/);
    expect(text).toMatch(/Division as the parser reads it: D3 3, D1 2/);
    const samples = text.split("5 sample records")[1]!.trim().split("\n").slice(1).filter((l) => l.startsWith("  "));
    expect(samples).toHaveLength(5);
    expect(samples.join("\n")).not.toMatch(/hometown|class_year|player/i);
  });
  it("handles a response that is not a list", () => {
    expect(describeNcaa({ message: "moved" }, "u").join("\n")).toMatch(/not a list of records.*message/);
    expect(fieldPaths({ a: 1, b: { c: "x" } }).sort()).toEqual(["a (number)", "b.c (string)"]);
  });
  it("reads only the cached pages, with no network and no contact email, through run.ts", async () => {
    const out = mkdtempSync(join(tmpdir(), "roster-out-"));
    const cache = join(out, ".cache");
    const f = new PoliteFetcher({ cacheDir: cache, userAgent: "UA", sleep: async () => undefined, fetchImpl: async (url) => ({ status: url.endsWith("robots.txt") ? 404 : 200, text: async () => (url.endsWith("robots.txt") ? "" : url.includes("MSO") ? mso : wso) }) });
    await f.get("https://web3.ncaa.org/directory/api/directory/memberList?type=12&sportCode=MSO&division=3");
    await f.get("https://web3.ncaa.org/directory/api/directory/memberList?type=12&sportCode=WSO&division=3");
    expect(debugNcaaCache(cache, "web3.ncaa.org").join("\n")).toMatch(/memberList\?type=12&sportCode=MSO&division=3: 6 records/);
    const sch = mkdtempSync(join(tmpdir(), "schools-"));
    writeFileSync(join(sch, "sources.json"), readFileSync("scripts/roster-research/schools/sources.json"));
    const env = { ...process.env, ROSTER_CONTACT_EMAIL: "" };
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--debug-source", "ncaa", "--out", out, "--schools", sch], { encoding: "utf8", env });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/6 records/);
    expect(debugNcaaCache(join(out, "nothing"), "web3.ncaa.org")[0]).toMatch(/No cached pages/);
    // --build-schools --lists-only: rebuilt from the cache, no email, no network.
    const lists = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--build-schools", "--division", "D3", "--lists-only", "--out", out, "--schools", sch], { encoding: "utf8", env });
    expect(lists.status, lists.stderr).toBe(0);
    expect(lists.stdout).toMatch(/D3: 4 schools, 2 men's programs, 3 women's programs, 1 schools with both/);
    expect(lists.stdout).toMatch(/Network requests this run: 0/);
  });
});
