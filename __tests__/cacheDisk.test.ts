import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { cacheFiles, cacheSize, pruneCache, readCacheEntry, readCacheFile, stripHtml, writeCacheEntry } from "../scripts/roster-research/cache";
import type { Getter } from "../scripts/roster-research/core";
import { atomicWriteFileSync, checkDisk, LowDiskError, repairTrailingLine } from "../scripts/roster-research/disk";
import { PoliteFetcher, type FetchLike } from "../scripts/roster-research/fetcher";
import { detectSchoolPlatform } from "../scripts/roster-research/platform";
import { enrichAll, type SchoolRecord } from "../scripts/roster-research/schoolList";
import { parseRosterHtml } from "../scripts/roster-research/sidearm";

const fx = (n: string) => readFileSync(new URL(`./fixtures/roster/${n}`, import.meta.url), "utf8");
const tmp = (p = "cache-") => mkdtempSync(join(tmpdir(), p));

/** A realistic page wrapper: head with scripts and styles, an inline SVG, a base64 image, a comment and a noscript, around the real content. */
const bloat = (inner: string): string =>
  `<!DOCTYPE html><html><head><title>Roster</title><meta charset="utf-8"><link rel="stylesheet" href="/a.css"><style>${".x{color:red}".repeat(2000)}</style><script>var big="${"x".repeat(50_000)}";</script></head>` +
  `<body><!-- tracking --><svg width="10" height="10"><path d="${"M0 0L1 1".repeat(500)}"/></svg><noscript><img src="/pixel.gif"></noscript>` +
  `<img src="data:image/png;base64,${"A".repeat(40_000)}" style="width:10px;background:url(data:image/png;base64,${"B".repeat(2000)})">` +
  `<script type="application/ld+json">{"a":"${"y".repeat(10_000)}"}</script>${inner}<script>window.x=1</script></body></html>`;

const ROSTERS = ["list.html", "list_clean.html", "list_broken_row.html", "table.html", "card.html"];

describe("stripping HTML before it is cached", () => {
  it("removes scripts, styles, svg, head, noscript, comments, style attributes and base64 images, and keeps content", () => {
    const html = bloat('<ul><li class="sidearm-roster-player"><a href="/sports/mens-soccer/roster/ann">Ann Lee</a></li></ul>');
    const out = stripHtml(html);
    expect(out).not.toMatch(/<script|<style|<svg|<noscript|<head|<!--|base64|style=/i);
    expect(out).toContain('class="sidearm-roster-player"');
    expect(out).toContain('href="/sports/mens-soccer/roster/ann"');
    expect(out).toContain("Ann Lee");
    expect(out.length).toBeLessThan(html.length / 20);
  });
  it("does not mistake <header> for <head>", () => {
    expect(stripHtml("<header><h1>Team</h1></header><main>x</main>")).toBe("<header><h1>Team</h1></header><main>x</main>");
  });
  it.each(ROSTERS)("the roster parser gives identical results on the stripped page: %s", (name) => {
    const original = fx(name);
    const want = parseRosterHtml(original);
    expect(want.players.length).toBeGreaterThan(0);
    expect(parseRosterHtml(stripHtml(original))).toEqual(want);
    expect(parseRosterHtml(stripHtml(bloat(original)))).toEqual(want); // with a head, scripts, svg and images around it
  });
});

describe("gzip cache files", () => {
  it("writes <sha1>.json.gz, gzip-compressed, with the HTML stripped, and reads it back", () => {
    const dir = tmp();
    const url = "https://x.edu/sports/mens-soccer/roster/2025";
    const html = bloat(fx("list.html"));
    const bytes = writeCacheEntry(dir, { url, status: 200, body: html, fetchedAt: "t" });
    const f = cacheFiles(dir, url);
    expect(existsSync(f.gz) && !existsSync(f.legacy)).toBe(true);
    const raw = readFileSync(f.gz);
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
    expect(bytes).toBe(raw.length);
    expect(raw.length).toBeLessThan(html.length / 10);
    const stored = JSON.parse(gunzipSync(raw).toString("utf8"));
    expect(stored).toMatchObject({ url, status: 200, fetchedAt: "t" });
    expect(stored.body).not.toMatch(/<script|base64/);
    expect(readCacheEntry(dir, url)?.body).toBe(stored.body);
    expect(readdirSync(join(dir, "x.edu")).some((n) => n.includes(".tmp-"))).toBe(false);
  });
  it("leaves JSON answers and robots.txt exactly as they were", () => {
    const dir = tmp();
    const json = '[{"orgId":1,"nameOfficial":"A <b> & C"}]';
    writeCacheEntry(dir, { url: "https://web3.ncaa.org/api?x=1", status: 200, body: json });
    expect(readCacheEntry(dir, "https://web3.ncaa.org/api?x=1")?.body).toBe(json);
    writeCacheEntry(dir, { url: "https://x.edu/robots.txt", status: 200, body: "User-agent: *\nDisallow: /a" });
    expect(readCacheEntry(dir, "https://x.edu/robots.txt")?.body).toBe("User-agent: *\nDisallow: /a");
  });
  it("still reads an older uncompressed <sha1>.json, and treats a damaged .gz as a miss", () => {
    const dir = tmp();
    const url = "https://old.edu/p";
    const f = cacheFiles(dir, url);
    mkdirSync(join(dir, "old.edu"), { recursive: true });
    writeFileSync(f.legacy, JSON.stringify({ url, status: 200, body: "<p>old</p>" }));
    expect(readCacheEntry(dir, url)?.body).toBe("<p>old</p>");
    writeFileSync(f.gz, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])); // cut short, as a full disk would leave it
    expect(readCacheFile(f.gz)).toBeNull();
    expect(readCacheEntry(dir, url)?.body).toBe("<p>old</p>"); // falls back, and the broken file is removed
    expect(existsSync(f.gz)).toBe(false);
  });
});

describe("the fetcher keeps less", () => {
  const html = bloat(fx("list.html"));
  const fetchImpl: FetchLike = async (url) => ({ status: 200, text: async () => (url.endsWith("robots.txt") ? "" : html) });
  const mk = (dir: string, extra: object = {}) => new PoliteFetcher({ cacheDir: dir, userAgent: "UA", sleep: async () => undefined, fetchImpl, ...extra });

  it("a roster page is cached stripped and gzipped; a school home page (cache: false) is not cached at all", async () => {
    const dir = tmp();
    const f = mk(dir);
    const roster = await f.get("https://x.edu/sports/mens-soccer/roster/2025");
    expect(roster.body).toBe(html); // the caller gets the full page this time
    await f.get("https://x.edu/", { cache: false });
    expect(existsSync(cacheFiles(dir, "https://x.edu/sports/mens-soccer/roster/2025").gz)).toBe(true);
    expect(existsSync(cacheFiles(dir, "https://x.edu/").gz)).toBe(false);
    expect(existsSync(cacheFiles(dir, "https://x.edu/").legacy)).toBe(false);
    const again = mk(dir);
    expect((await again.get("https://x.edu/sports/mens-soccer/roster/2025")).fromCache).toBe(true);
    expect(parseRosterHtml((await again.get("https://x.edu/sports/mens-soccer/roster/2025")).body)).toEqual(parseRosterHtml(fx("list.html")));
  });
  it("detecting the platform keeps only the platform and the HTTP status", async () => {
    const dir = tmp();
    const f = mk(dir);
    const home = fx("home_sidearm.html");
    const getter: Getter = { get: (u, o) => (u === "https://s.edu/" ? mk(dir, { fetchImpl: async (url: string) => ({ status: 200, text: async () => (url.endsWith("robots.txt") ? "" : home) }) }).get(u, o) : f.get(u, o)) };
    expect(await detectSchoolPlatform({ base: "https://s.edu" }, getter)).toEqual({ platform: "sidearm", problem: "", status: 200 });
    expect(existsSync(cacheFiles(dir, "https://s.edu/").gz)).toBe(false);
  });
  it("a cache that already holds a page does not need the network", async () => {
    const dir = tmp();
    await mk(dir).get("https://x.edu/a");
    const offline = new PoliteFetcher({ cacheDir: dir, userAgent: "UA", offline: true });
    expect((await offline.get("https://x.edu/a")).status).toBe(200);
  });
});

describe("--prune-cache", () => {
  it("deletes pages the progress file says are parsed and home pages with a stored platform, keeps the rest, compacts old files, reports MB", () => {
    const dir = tmp();
    const page = (u: string) => writeCacheEntry(dir, { url: u, status: 200, body: bloat(`<p>${u}</p>`) });
    for (const u of ["https://a.edu/r1", "https://a.edu/r2", "https://b.edu/r1", "https://a.edu/"]) page(u);
    // an older uncompressed entry that is still wanted (a roster not yet parsed)
    const oldUrl = "https://c.edu/r1";
    mkdirSync(join(dir, "c.edu"), { recursive: true });
    writeFileSync(cacheFiles(dir, oldUrl).legacy, JSON.stringify({ url: oldUrl, status: 200, body: bloat("<p>old</p>") }));
    const before = cacheSize(dir);
    const r = pruneCache({ cacheDir: dir, parsedUrls: ["https://a.edu/r1", "https://a.edu/r2", "https://never-cached.edu/x"], homeUrls: ["https://a.edu/"] });
    expect(r).toMatchObject({ deletedPages: 2, deletedHomePages: 1, compacted: 1 });
    expect(r.freedBytes).toBeGreaterThan(50_000); // the old uncompressed page was ~100 KB
    expect(readCacheEntry(dir, "https://b.edu/r1")).not.toBeNull(); // not parsed yet: kept
    expect(readCacheEntry(dir, "https://a.edu/r1")).toBeNull();
    expect(existsSync(cacheFiles(dir, oldUrl).legacy)).toBe(false);
    expect(readCacheEntry(dir, oldUrl)?.body).toContain("old"); // compacted into a .json.gz
    expect(cacheSize(dir).bytes).toBeLessThan(before.bytes);
  });
  it("through run.ts: reads outcomes.jsonl, prints how many MB it freed, needs no contact email and no network", () => {
    const out = tmp("roster-out-");
    const sch = tmp("schools-");
    const cache = join(out, ".cache");
    const parsed = "https://p.edu/sports/mens-soccer/roster/2025";
    const waiting = "https://w.edu/sports/mens-soccer/roster/2025";
    writeCacheEntry(cache, { url: parsed, status: 200, body: bloat(fx("list.html")) });
    writeCacheEntry(cache, { url: waiting, status: 200, body: bloat(fx("list.html")) });
    writeCacheEntry(cache, { url: "https://p.edu/", status: 200, body: bloat("<p>home</p>") });
    mkdirSync(join(out, ".work"), { recursive: true });
    writeFileSync(join(out, ".work", "outcomes.jsonl"), JSON.stringify({ key: "k1", status: "ok", urls_tried: [parsed] }) + "\n" + JSON.stringify({ key: "k2", status: "failed", urls_tried: [waiting] }) + "\n");
    writeFileSync(join(sch, "d3.json"), JSON.stringify({ schools: [{ id: "p", school: "P", division: "D3", conference: "X", base: "https://p.edu", platform: "sidearm" }] }));
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--prune-cache", "--out", out, "--schools", sch], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "" } });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/deleted 1 parsed pages and 1 school home pages/);
    expect(res.stdout).toMatch(/Freed \d+\.\d MB/);
    expect(res.stdout).toMatch(/Cache size: \d+\.\d MB in 1 files/);
    expect(readCacheEntry(cache, waiting)).not.toBeNull(); // the failed page stays
  });
});

describe("a nearly full disk", () => {
  const low = () => 200 * 1048576;
  it("checkDisk passes with space and throws a clear LowDiskError under 1 GB", () => {
    expect(() => checkDisk("/x", 1073741824, () => 5 * 1073741824)).not.toThrow();
    try {
      checkDisk("/x", 1073741824, low);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LowDiskError);
      expect((e as Error).message).toMatch(/Disk almost full \(200 MB free/);
      expect((e as Error).message).toMatch(/re-run the same command to resume/);
    }
  });
  it("the fetcher stops before touching the network, and a LowDiskError is not turned into a page error", async () => {
    let calls = 0;
    const f = new PoliteFetcher({ cacheDir: tmp(), userAgent: "UA", freeBytes: low, minFreeBytes: 1073741824, fetchImpl: async () => { calls++; return { status: 200, text: async () => "" }; } });
    await expect(f.get("https://x.edu/a")).rejects.toBeInstanceOf(LowDiskError);
    expect(calls).toBe(0);
    // cached pages are still served with no disk space
    const dir = tmp();
    writeCacheEntry(dir, { url: "https://x.edu/robots.txt", status: 404, body: "" });
    writeCacheEntry(dir, { url: "https://x.edu/a", status: 200, body: "<p>hi</p>" });
    const g = new PoliteFetcher({ cacheDir: dir, userAgent: "UA", freeBytes: low, minFreeBytes: 1073741824 });
    expect((await g.get("https://x.edu/a")).status).toBe(200);
  });
  it("the school checks save the schools already checked, then report the low disk once", async () => {
    let n = 0;
    const getter: Getter = { get: async (u) => { if (++n > 2) throw new LowDiskError(1, "x"); return { url: u, status: 404, body: "", fromCache: false }; } };
    const mkSchool = (i: number): SchoolRecord => ({ id: `s${i}`, school: `S${i}`, division: "D3", conference: "", base: `https://s${i}.edu`, platform: "unknown", roster: { status: "unchecked", reason: "" } });
    const saved: SchoolRecord[][] = [];
    await expect(enrichAll([1, 2, 3, 4, 5].map(mkSchool), getter, { season: 2025, nowIso: "n", concurrency: 1, save: (a) => saved.push(a) })).rejects.toBeInstanceOf(LowDiskError);
    const last = saved[saved.length - 1]!;
    expect(last.filter((s) => s.roster?.status === "needs_review")).toHaveLength(2); // the two checked before the stop are kept
    expect(last.filter((s) => s.roster?.status === "unchecked")).toHaveLength(3);
  });
  it("run.ts stops with a clear message and exit code 75, leaving the progress file untouched", () => {
    const out = tmp("roster-out-");
    const sch = tmp("schools-");
    mkdirSync(join(out, ".work"), { recursive: true });
    const progress = JSON.stringify({ key: "k", status: "ok", urls_tried: [] }) + "\n";
    writeFileSync(join(out, ".work", "outcomes.jsonl"), progress);
    writeFileSync(join(sch, "d3.json"), JSON.stringify({ schools: [{ id: "p", school: "P", division: "D3", conference: "X", base: "https://p.edu", platform: "sidearm", men: true }] }));
    const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/roster-research/run.ts", "--division", "D3", "--season", "2025", "--out", out, "--schools", sch], { encoding: "utf8", env: { ...process.env, ROSTER_CONTACT_EMAIL: "a@b.co", ROSTER_MIN_FREE_MB: "999999999" } });
    expect(res.status, res.stdout + res.stderr).toBe(75);
    expect(res.stderr).toMatch(/STOPPED: Disk almost full/);
    expect(res.stderr).toMatch(/re-run the same command to resume/);
    expect(readFileSync(join(out, ".work", "outcomes.jsonl"), "utf8")).toBe(progress);
  });
});

describe("progress files are written atomically", () => {
  it("replaces a file in one step and leaves no temporary file", () => {
    const dir = tmp();
    const f = join(dir, "d3.json");
    writeFileSync(f, "old");
    atomicWriteFileSync(f, "new");
    expect(readFileSync(f, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["d3.json"]);
  });
  it("a failed write leaves the old file intact and cleans up", () => {
    const dir = tmp();
    const f = join(dir, "d3.json");
    writeFileSync(f, "old");
    mkdirSync(join(dir, "blocked"));
    expect(() => atomicWriteFileSync(join(dir, "blocked"), "x")).toThrow(); // cannot rename a file over a directory
    expect(readFileSync(f, "utf8")).toBe("old");
    expect(readdirSync(dir).sort()).toEqual(["blocked", "d3.json"]);
    expect(statSync(f).size).toBe(3);
  });
  it("repairs an append-only file that lost its final newline", () => {
    const dir = tmp();
    const f = join(dir, "outcomes.jsonl");
    writeFileSync(f, '{"key":"a"}\n{"key":"b"');
    expect(repairTrailingLine(f)).toBe(true);
    expect(readFileSync(f, "utf8").endsWith("\n")).toBe(true);
    expect(repairTrailingLine(f)).toBe(false);
  });
});
