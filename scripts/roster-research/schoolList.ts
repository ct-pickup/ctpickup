import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Division, Getter, School } from "./core.ts";
import { detectSchoolPlatform, verifyRoster, type Platform } from "./platform.ts";
import { parseNcaaDirectory, parseSchoolTables, siteOrigin, type ParsedSchool } from "./sources.ts";
import { normalizeState } from "./states.ts";

/**
 * Builds the school lists (schools/d1.json ... juco.json) the roster collector plans from: every men's and women's soccer program in
 * NCAA D1, D2, D3 and the NJCAA. Official directories first; Wikipedia lists if a directory is unreachable or has changed shape.
 * It only writes schools a source actually listed, and records which source each came from.
 */

export const DIVISIONS: Division[] = ["D1", "D2", "D3", "JUCO"];
export const divisionFile = (d: Division): string => `${d.toLowerCase()}.json`;

export type SourcesConfig = {
  ncaa?: { url: string; sportCodes: { men: string; women: string }; divisionCodes: Record<string, number | string> };
  wikipedia?: Record<string, { men?: string; women?: string }>;
  njcaa?: { men?: string[]; women?: string[] };
};

const slug = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A name to compare schools by: no accents, punctuation, parentheticals or a leading "The". */
export const nameKey = (s: string): string => slug(s).replace(/^the-/, "");
const hostOf = (base: string): string => {
  try {
    return new URL(base).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export type SchoolRecord = School & { ncaa_id?: string };

// ---------------------------------------------------------------------------------------------------------------------------
// Collecting a division from its sources
// ---------------------------------------------------------------------------------------------------------------------------

type TeamResult = { schools: ParsedSchool[]; source: string };

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const wikiUrl = (title: string): string => `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=render`;

/** One team's list for a division: the official directory if it gives schools, otherwise Wikipedia. Empty list means nothing worked. */
export async function collectTeam(division: Division, team: "men" | "women", cfg: SourcesConfig, fetcher: Getter, log: (s: string) => void): Promise<TeamResult> {
  if (division === "JUCO") {
    for (const url of cfg.njcaa?.[team] ?? []) {
      const r = await fetcher.get(url);
      const found = r.status === 200 ? parseSchoolTables(r.body) : [];
      log(`  njcaa ${team}: ${url} -> ${r.status === 200 ? `${found.length} schools` : (r.error ?? `HTTP ${r.status}`)}`);
      if (found.length > 0) return { schools: found, source: `njcaa:${url}` };
    }
    return { schools: [], source: "" };
  }
  const n = cfg.ncaa;
  if (n && n.divisionCodes[division] !== undefined) {
    const url = fill(n.url, { sportCode: n.sportCodes[team], divisionCode: n.divisionCodes[division]! });
    const r = await fetcher.get(url);
    let found: ParsedSchool[] = [];
    if (r.status === 200) {
      try {
        found = parseNcaaDirectory(JSON.parse(r.body));
      } catch {
        found = [];
      }
    }
    log(`  ncaa directory ${division} ${team}: ${r.status === 200 ? `${found.length} schools` : (r.error ?? `HTTP ${r.status}`)}`);
    if (found.length > 0) return { schools: found, source: "ncaa-directory" };
  }
  const title = cfg.wikipedia?.[division]?.[team];
  if (title) {
    const r = await fetcher.get(wikiUrl(title));
    const found = r.status === 200 ? parseSchoolTables(r.body) : [];
    log(`  wikipedia ${division} ${team}: ${r.status === 200 ? `${found.length} schools` : (r.error ?? `HTTP ${r.status}`)}`);
    if (found.length > 0) return { schools: found, source: `wikipedia:${title}` };
  }
  return { schools: [], source: "" };
}

/** Men's and women's lists for one division into one record per school. A team a source could not supply is left unknown, not false. */
export function combineTeams(division: Division, men: TeamResult, women: TeamResult): SchoolRecord[] {
  const byKey = new Map<string, SchoolRecord>();
  const used = new Set<string>();
  const add = (p: ParsedSchool, team: "men" | "women", source: string) => {
    const nm = nameKey(p.name);
    const st = normalizeState(p.state) ?? "";
    const key = p.ncaaId ? `id:${p.ncaaId}` : `n:${nm}|${st}`;
    const nk = `n:${nm}|${st}`;
    // Same name in a different state is a different school. A list with no state for a school may match the one with that name.
    const plain = byKey.get(`n:${nm}|`) ?? [...byKey.entries()].find(([k, v]) => k.startsWith(`n:${nm}|`) && (!st || !v.state))?.[1];
    const cur = byKey.get(key) ?? byKey.get(nk) ?? plain ?? ({ id: "", school: p.name, division, conference: p.conference, base: p.base, state: p.state || undefined, platform: "unknown", source: "", roster: { status: "unchecked", reason: "" } } as SchoolRecord);
    if (!cur.base && p.base) cur.base = p.base;
    if (!cur.conference && p.conference) cur.conference = p.conference;
    if (!cur.state && p.state) cur.state = p.state;
    if (p.ncaaId) cur.ncaa_id = p.ncaaId;
    cur[team] = true;
    const srcs = new Set((cur.source ? cur.source.split(" + ") : []).concat(`${team}:${source}`));
    cur.source = [...srcs].join(" + ");
    byKey.set(key, cur);
    byKey.set(`n:${nm}|${cur.state ?? ""}`, cur);
    used.add(key);
  };
  for (const p of men.schools) add(p, "men", men.source);
  for (const p of women.schools) add(p, "women", women.source);
  const list = [...new Set(byKey.values())];
  for (const s of list) {
    if (s.men === undefined && men.schools.length > 0) s.men = false;
    if (s.women === undefined && women.schools.length > 0) s.women = false;
    s.state = normalizeState(s.state) ?? s.state;
  }
  // Unique, readable ids.
  const seen = new Set<string>();
  for (const s of list.sort((a, b) => a.school.localeCompare(b.school))) {
    let id = slug(s.school) || "school";
    if (seen.has(id) && s.state) id = `${id}-${s.state.toLowerCase()}`;
    while (seen.has(id)) id += "-2";
    seen.add(id);
    s.id = id;
  }
  return list;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Merging with what is already on disk
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Existing entries win: their values are kept exactly, and only fields they lack are filled from the new list. A school matches an
 * existing one by website host, then by name. Schools in neither list's counterpart are kept.
 */
export function mergeSchools(existing: SchoolRecord[], incoming: SchoolRecord[]): SchoolRecord[] {
  const out = existing.map((e) => ({ ...e }));
  const byHost = new Map<string, SchoolRecord>();
  const byName = new Map<string, SchoolRecord>();
  const reg = (r: SchoolRecord) => {
    const h = hostOf(r.base);
    if (h) byHost.set(h, r);
    byName.set(nameKey(r.school), r);
  };
  out.forEach(reg);
  const ids = new Set(out.map((o) => o.id));
  for (const inc of incoming) {
    const h = hostOf(inc.base);
    let match = (h && byHost.get(h)) || byName.get(nameKey(inc.school));
    // Same name, different state: a different school.
    if (match && match.state && inc.state && match.state !== inc.state && !(h && byHost.get(h) === match)) match = undefined;
    if (match) {
      for (const [k, v] of Object.entries(inc)) if ((match as Record<string, unknown>)[k] === undefined || (match as Record<string, unknown>)[k] === "") (match as Record<string, unknown>)[k] = v;
      reg(match);
    } else {
      let id = inc.id;
      while (ids.has(id)) id += "-2";
      ids.add(id);
      const rec = { ...inc, id };
      out.push(rec);
      reg(rec);
    }
  }
  return out.sort((a, b) => a.school.localeCompare(b.school));
}

export type Overrides = Record<string, Partial<Pick<SchoolRecord, "base" | "platform" | "men" | "women" | "state" | "conference">> & { skip?: boolean }>;

/** Hand fixes keyed by school id or exact name: a website address, a platform, a program flag. {"skip": true} drops a school. */
export function applyOverrides(schools: SchoolRecord[], overrides: Overrides): SchoolRecord[] {
  const out: SchoolRecord[] = [];
  for (const s of schools) {
    const o = overrides[s.id] ?? overrides[s.school];
    if (o?.skip) continue;
    out.push(o ? ({ ...s, ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== "skip")), ...(o.base !== undefined ? { base: siteOrigin(o.base) } : {}) } as SchoolRecord) : s);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Platform detection and roster address checks, with a few workers and a save point
// ---------------------------------------------------------------------------------------------------------------------------

export const needsCheck = (s: SchoolRecord, refresh: boolean): boolean => {
  const r = s.roster;
  if (refresh || !r || r.status === "unchecked") return true;
  return r.status === "needs_review" && /network error|unreachable|timeout/i.test(r.reason);
};

export async function enrichSchool(s: SchoolRecord, fetcher: Getter, season: number, nowIso: string, opts: { verify?: boolean } = {}): Promise<SchoolRecord> {
  const det = s.platform && s.platform !== "unknown" ? { platform: s.platform as Platform, problem: "" } : await detectSchoolPlatform(s, fetcher);
  const next: SchoolRecord = { ...s, platform: det.platform };
  if (det.problem) {
    next.roster = { status: "needs_review", reason: det.problem, season, checked_at: nowIso };
    return next;
  }
  if (opts.verify === false) {
    next.roster = det.platform === "sidearm" ? { status: "unchecked", reason: "", season } : await verifyRoster({ ...s, platform: det.platform }, fetcher, season, nowIso);
    return next;
  }
  next.roster = await verifyRoster({ ...s, platform: det.platform }, fetcher, season, nowIso);
  return next;
}

export async function enrichAll(
  schools: SchoolRecord[],
  fetcher: Getter,
  o: { season: number; nowIso: string; refresh?: boolean; verify?: boolean; limit?: number; concurrency?: number; save?: (all: SchoolRecord[]) => void; log?: (s: string) => void },
): Promise<SchoolRecord[]> {
  const out = [...schools];
  const todo = out.map((s, i) => ({ s, i })).filter(({ s }) => needsCheck(s, !!o.refresh)).slice(0, o.limit ?? Infinity);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { s, i } = todo[next++]!;
      out[i] = await enrichSchool(s, fetcher, o.season, o.nowIso, { verify: o.verify });
      done++;
      if (done % 25 === 0) {
        o.save?.(out);
        o.log?.(`  checked ${done} of ${todo.length} schools`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 6) }, worker));
  o.save?.(out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------------------

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Every school in every list file, merged by id (the first file wins; later files only fill in fields it lacks). */
export function loadSchoolFiles(dir: string): SchoolRecord[] {
  if (!existsSync(dir)) return [];
  const byId = new Map<string, SchoolRecord>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !["sources.json", "overrides.json"].includes(f)).sort()) {
    const j = readJson<{ schools?: SchoolRecord[] }>(join(dir, f));
    for (const s of j?.schools ?? []) {
      const cur = byId.get(s.id);
      if (!cur) byId.set(s.id, { ...s });
      else for (const [k, v] of Object.entries(s)) if ((cur as Record<string, unknown>)[k] === undefined || (cur as Record<string, unknown>)[k] === "") (cur as Record<string, unknown>)[k] = v;
    }
  }
  return [...byId.values()];
}

export function writeDivisionFile(dir: string, division: Division, schools: SchoolRecord[]): void {
  mkdirSync(dir, { recursive: true });
  const body = { _note: `Built by run.ts --build-schools. Public school names and website addresses only. Edit schools/overrides.json for hand fixes.`, schools: schools.filter((s) => s.division === division) };
  writeFileSync(join(dir, divisionFile(division)), JSON.stringify(body, null, 1) + "\n");
}

export type BuildOptions = { dir: string; sources: SourcesConfig; overrides: Overrides; fetcher: Getter; divisions: Division[]; season: number; nowIso: string; refresh?: boolean; verify?: boolean; limit?: number; log: (s: string) => void };

/** The whole build: collect each division, merge with existing files, apply overrides, detect platforms, check roster addresses, save. */
export async function buildSchoolLists(o: BuildOptions): Promise<SchoolRecord[]> {
  const all = loadSchoolFiles(o.dir);
  let result = all;
  for (const division of o.divisions) {
    o.log(`${division}:`);
    const men = await collectTeam(division, "men", o.sources, o.fetcher, o.log);
    const women = await collectTeam(division, "women", o.sources, o.fetcher, o.log);
    const incoming = combineTeams(division, men, women);
    if (incoming.length === 0) o.log(`  no source gave any ${division} schools. Existing ${divisionFile(division)} entries are kept; add schools by hand or fix schools/sources.json.`);
    const mine = result.filter((s) => s.division === division);
    const merged = applyOverrides(mergeSchools(mine, incoming), o.overrides);
    result = [...result.filter((s) => s.division !== division), ...merged];
    writeDivisionFile(o.dir, division, result);
    o.log(`  ${merged.length} ${division} schools (${incoming.length} from sources)`);
    const enriched = await enrichAll(result.filter((s) => s.division === division), o.fetcher, {
      season: o.season, nowIso: o.nowIso, refresh: o.refresh, verify: o.verify, limit: o.limit, log: o.log,
      save: (part) => writeDivisionFile(o.dir, division, [...result.filter((s) => s.division !== division), ...part]),
    });
    result = [...result.filter((s) => s.division !== division), ...enriched];
    writeDivisionFile(o.dir, division, result);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reports (school names, divisions and reasons only)
// ---------------------------------------------------------------------------------------------------------------------------

const PLATFORM_LABEL: Record<string, string> = { sidearm: "Sidearm Sports", prestosports: "PrestoSports", wmt: "WMT Games / Learfield-style", athleticsdotcom: "Athletics.com", unknown: "unknown" };

/** The reason a school has a problem, grouped into a short label such as "PrestoSports sites" or "roster page not found". */
export function problemGroup(s: SchoolRecord): string | null {
  const r = s.roster;
  if (!r || r.status === "verified" || r.status === "unchecked") return null;
  if (r.status === "unsupported_platform") return `${PLATFORM_LABEL[s.platform ?? "unknown"]} sites`;
  const reason = r.reason.toLowerCase();
  if (reason.includes("no athletics website")) return "no athletics website address";
  if (reason.includes("robots")) return "blocked by robots.txt";
  if (reason.includes("unreachable") || reason.includes("network") || reason.includes("timeout")) return "site unreachable / network error";
  if (reason.includes("not found")) return "roster page not found";
  if (reason.includes("layout")) return "roster layout not recognised";
  return "other needs_review";
}

export function schoolReport(schools: SchoolRecord[]): string[] {
  const lines: string[] = [];
  const count = <T>(items: T[], key: (t: T) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  lines.push("=== School lists ===");
  for (const d of DIVISIONS) {
    const ds = schools.filter((s) => s.division === d);
    lines.push(`${d}: ${ds.length} schools, ${ds.filter((s) => s.men === true).length} men's programs, ${ds.filter((s) => s.women === true).length} women's programs (${ds.filter((s) => s.men === undefined || s.women === undefined).length} schools with a program flag unknown)`);
  }
  lines.push("Schools per platform:");
  for (const [p, n] of count(schools, (s) => PLATFORM_LABEL[s.platform ?? "unknown"] ?? "unknown")) lines.push(`  ${p}: ${n}`);
  const st = count(schools, (s) => s.roster?.status ?? "unchecked");
  lines.push(`Roster addresses: ${["verified", "needs_review", "unsupported_platform", "unchecked"].map((k) => `${k} ${st.find(([x]) => x === k)?.[1] ?? 0}`).join(", ")}`);
  lines.push("Biggest groups of problems (top 15):");
  const problems = count(schools.map(problemGroup).filter((p): p is string => !!p), (p) => p).slice(0, 15);
  if (problems.length === 0) lines.push("  (none)");
  for (const [p, n] of problems) lines.push(`  ${p}: ${n}`);
  const bySource = count(schools, (s) => (s.source ?? "hand-written").replace(/(men|women):/g, "").split(" + ").map((x) => x.split(":")[0]).filter((v, i, a) => a.indexOf(v) === i).join(" + ") || "hand-written");
  lines.push("Where the schools came from:");
  for (const [p, n] of bySource) lines.push(`  ${p}: ${n}`);
  return lines;
}

export function needsReviewLines(schools: SchoolRecord[], division?: string): string[] {
  const rows = schools.filter((s) => s.roster && (s.roster.status === "needs_review" || s.roster.status === "unsupported_platform") && (!division || s.division === division));
  return rows.map((s) => `${s.school} | ${s.division} | ${s.roster!.status}: ${s.roster!.reason}`);
}
