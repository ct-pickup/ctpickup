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

export type SchoolRecord = School & { ncaa_id?: string; provisional?: boolean };

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
      // An NJCAA list is the JUCO list by construction.
      if (found.length > 0) return { schools: found.map((f) => ({ ...f, division })), source: `njcaa:${url}` };
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
    // A Wikipedia "NCAA Division III programs" article is that division's list by construction (the page itself says the division).
    if (found.length > 0) return { schools: found.map((f) => ({ ...f, division })), source: `wikipedia:${title}` };
  }
  return { schools: [], source: "" };
}

export type FilterStats = { otherDivisionSchools: number; otherDivisionRows: number; divisionUnknownSchools: number; divisionUnknownRows: number; notSoccerRows: number; deactivatedRows: number; staleRemoved: number };
export const emptyStats = (): FilterStats => ({ otherDivisionSchools: 0, otherDivisionRows: 0, divisionUnknownSchools: 0, divisionUnknownRows: 0, notSoccerRows: 0, deactivatedRows: 0, staleRemoved: 0 });
export const addStats = (a: FilterStats, b: FilterStats): FilterStats => ({
  otherDivisionSchools: a.otherDivisionSchools + b.otherDivisionSchools, otherDivisionRows: a.otherDivisionRows + b.otherDivisionRows,
  divisionUnknownSchools: a.divisionUnknownSchools + b.divisionUnknownSchools, divisionUnknownRows: a.divisionUnknownRows + b.divisionUnknownRows,
  notSoccerRows: a.notSoccerRows + b.notSoccerRows, deactivatedRows: a.deactivatedRows + b.deactivatedRows, staleRemoved: a.staleRemoved + b.staleRemoved,
});

/** The identity of a school across rows: its athletics website host, else its name and state. */
export const schoolKeys = (p: { name: string; state?: string; base?: string; ncaaId?: string }): string[] => {
  // The NCAA's orgId is the stable identity: two records with the same orgId are one school, different orgIds never merge.
  if (p.ncaaId) return [`id:${p.ncaaId}`];
  const keys: string[] = [];
  const h = hostOf(p.base ?? "");
  if (h) keys.push(`host:${h}`);
  keys.push(`name:${nameKey(p.name)}|${normalizeState(p.state) ?? ""}`);
  return keys;
};

/** Every way a school can be recognised (orgId, website host, name and state), for matching against older entries on disk. */
export const allSchoolKeys = (p: { name: string; state?: string; base?: string; ncaaId?: string }): string[] => [
  ...(p.ncaaId ? [`id:${p.ncaaId}`] : []),
  ...schoolKeys({ name: p.name, state: p.state, base: p.base }),
];

/**
 * Men's and women's lists for one division into one record per school.
 *   - A row is kept only if ITS OWN division value is the division being built. The division of the request is never trusted: a
 *     directory that ignores the division parameter returns every school, and those rows are dropped (and counted) here.
 *   - A row with no readable division is dropped and counted as "division unknown". Division-specific sources (a Wikipedia list
 *     for one division, the NJCAA list) were tagged with their division when they were read.
 *   - A row that lists sports but no soccer is dropped; a row's own sports decide men/women, otherwise the list it came from does.
 *   - One school in several rows is merged (by website host, else name and state), men and women together.
 *   - A team a source could not supply is left unknown, not false.
 */
export function combineTeamsWithStats(division: Division, men: TeamResult, women: TeamResult): { records: SchoolRecord[]; stats: FilterStats } {
  const stats = emptyStats();
  const byKey = new Map<string, SchoolRecord>();
  const otherDiv = new Set<string>();
  const unknownDiv = new Set<string>();
  const find = (keys: string[]): SchoolRecord | undefined => keys.map((k) => byKey.get(k)).find(Boolean);
  const add = (p: ParsedSchool, team: "men" | "women", source: string) => {
    const keys = schoolKeys(p);
    const cur = find(keys) ?? ({ id: "", name: p.name, school: p.name, division, conference: p.conference, base: p.base, state: normalizeState(p.state) ?? (p.state || undefined), platform: "unknown", source: "", roster: { status: "unchecked", reason: "" } } as SchoolRecord);
    if (!cur.base && p.base) cur.base = p.base;
    if (!cur.conference && p.conference) cur.conference = p.conference;
    if (!cur.state && p.state) cur.state = normalizeState(p.state) ?? p.state;
    if (p.ncaaId) cur.ncaa_id = p.ncaaId;
    if (p.provisional) cur.provisional = true;
    cur[team] = true;
    cur.source = [...new Set((cur.source ? cur.source.split(" + ") : []).concat(`${team}:${source}`))].join(" + ");
    for (const k of [...keys, ...schoolKeys({ name: cur.school, state: cur.state, base: cur.base, ncaaId: cur.ncaa_id })]) byKey.set(k, cur);
  };
  const feed = (r: TeamResult, requestTeam: "men" | "women") => {
    for (const p of r.schools) {
      if (p.deactivated) {
        stats.deactivatedRows++;
        continue;
      }
      const d = p.division ?? "";
      if (d === "") {
        stats.divisionUnknownRows++;
        unknownDiv.add(schoolKeys(p)[0]!);
        continue;
      }
      if (d !== division) {
        stats.otherDivisionRows++;
        otherDiv.add(schoolKeys(p)[0]!);
        continue;
      }
      const teams = p.teams !== undefined ? p.teams : [requestTeam];
      if (teams.length === 0) {
        stats.notSoccerRows++;
        continue;
      }
      for (const t of teams) add(p, t, r.source);
    }
  };
  feed(men, "men");
  feed(women, "women");
  stats.otherDivisionSchools = otherDiv.size;
  stats.divisionUnknownSchools = unknownDiv.size;

  const list = [...new Set(byKey.values())];
  for (const sch of list) {
    if (sch.men === undefined && men.schools.length > 0) sch.men = false;
    if (sch.women === undefined && women.schools.length > 0) sch.women = false;
  }
  // Unique, readable ids.
  const seen = new Set<string>();
  for (const sch of list.sort((a, b) => a.school.localeCompare(b.school))) {
    let id = slug(sch.school) || "school";
    if (seen.has(id) && sch.state) id = `${id}-${sch.state.toLowerCase()}`;
    while (seen.has(id)) id += "-2";
    seen.add(id);
    sch.id = id;
  }
  return { records: list, stats };
}

export const combineTeams = (division: Division, men: TeamResult, women: TeamResult): SchoolRecord[] => combineTeamsWithStats(division, men, women).records;

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

const GENERATED_FILES = new Set(DIVISIONS.map(divisionFile));
const withName = (r: SchoolRecord): SchoolRecord => {
  const name = r.name ?? r.school;
  return name === r.name && r.school ? r : { ...r, name, school: r.school ?? name };
};

/** Every school in every list file, merged by id (the first file wins; later files only fill in fields it lacks). `name` and `school` both hold the display name. */
export function loadSchoolFiles(dir: string): SchoolRecord[] {
  if (!existsSync(dir)) return [];
  const byId = new Map<string, SchoolRecord>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !["sources.json", "overrides.json"].includes(f)).sort()) {
    const j = readJson<{ schools?: SchoolRecord[] }>(join(dir, f));
    for (const raw of j?.schools ?? []) {
      const s = withName(raw);
      const cur = byId.get(s.id);
      if (!cur) byId.set(s.id, { ...s });
      else for (const [k, v] of Object.entries(s)) if ((cur as Record<string, unknown>)[k] === undefined || (cur as Record<string, unknown>)[k] === "") (cur as Record<string, unknown>)[k] = v;
    }
  }
  return [...byId.values()];
}

/** Ids of schools in hand-written list files (anything other than d1/d2/d3/juco.json, like d3-nescac.json). The builder never removes these. */
export function curatedIds(dir: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !GENERATED_FILES.has(f) && !["sources.json", "overrides.json"].includes(f)))
    for (const s of readJson<{ schools?: SchoolRecord[] }>(join(dir, f))?.schools ?? []) ids.add(s.id);
  return ids;
}

export function writeDivisionFile(dir: string, division: Division, schools: SchoolRecord[]): void {
  mkdirSync(dir, { recursive: true });
  const body = { _note: `Built by run.ts --build-schools. Public school names and website addresses only. Edit schools/overrides.json for hand fixes.`, schools: schools.filter((s) => s.division === division).map(withName) };
  writeFileSync(join(dir, divisionFile(division)), JSON.stringify(body, null, 1) + "\n");
}

export type BuildOptions = { dir: string; sources: SourcesConfig; overrides: Overrides; fetcher: Getter; divisions: Division[]; season: number; nowIso: string; refresh?: boolean; verify?: boolean; listsOnly?: boolean; limit?: number; log: (s: string) => void };
export type BuildResult = { schools: SchoolRecord[]; stats: FilterStats };

/**
 * The whole build: collect each division, keep only schools of that division, merge with existing files, apply overrides, detect
 * platforms, check roster addresses, save. When a source gave schools for a division, builder-made entries it no longer lists (for
 * example D1 and D2 schools that an earlier build put in the D3 file) are removed; hand-written entries (d3-nescac.json) never are.
 */
export async function buildSchoolLists(o: BuildOptions): Promise<BuildResult> {
  const curated = curatedIds(o.dir);
  let result = loadSchoolFiles(o.dir);
  let stats = emptyStats();
  for (const division of o.divisions) {
    o.log(`${division}:`);
    const men = await collectTeam(division, "men", o.sources, o.fetcher, o.log);
    const women = await collectTeam(division, "women", o.sources, o.fetcher, o.log);
    const { records: incoming, stats: st } = combineTeamsWithStats(division, men, women);
    o.log(`  kept ${incoming.length} ${division} schools; dropped ${st.otherDivisionSchools} that belong to another division (${st.otherDivisionRows} rows), ${st.divisionUnknownSchools} with division unknown (${st.divisionUnknownRows} rows), ${st.deactivatedRows} deactivated members (rows), ${st.notSoccerRows} rows with no soccer program (other sources only)`);
    if (incoming.length === 0) o.log(`  no source gave any ${division} schools. Existing ${divisionFile(division)} entries are kept; add schools by hand or fix schools/sources.json.`);
    const mine = result.filter((s) => s.division === division);
    let base = mine;
    if (incoming.length > 0) {
      const keep = new Set(incoming.flatMap((r) => allSchoolKeys({ name: r.school, state: r.state, base: r.base, ncaaId: r.ncaa_id })));
      base = mine.filter((m) => curated.has(m.id) || !m.source || allSchoolKeys({ name: m.school, state: m.state, base: m.base, ncaaId: m.ncaa_id }).some((k) => keep.has(k)));
      st.staleRemoved = mine.length - base.length;
      if (st.staleRemoved) o.log(`  removed ${st.staleRemoved} entries from an earlier build that this source does not list as ${division}`);
    }
    stats = addStats(stats, st);
    const merged = applyOverrides(mergeSchools(base, incoming), o.overrides);
    result = [...result.filter((s) => s.division !== division), ...merged];
    writeDivisionFile(o.dir, division, result);
    o.log(`  ${merged.length} ${division} schools in ${divisionFile(division)}`);
    if (o.listsOnly) continue;
    const enriched = await enrichAll(result.filter((s) => s.division === division), o.fetcher, {
      season: o.season, nowIso: o.nowIso, refresh: o.refresh, verify: o.verify, limit: o.limit, log: o.log,
      save: (part) => writeDivisionFile(o.dir, division, [...result.filter((s) => s.division !== division), ...part]),
    });
    result = [...result.filter((s) => s.division !== division), ...enriched];
    writeDivisionFile(o.dir, division, result);
  }
  return { schools: result, stats };
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
    const both = ds.filter((s) => s.men === true && s.women === true).length;
    const prov = ds.filter((s) => s.provisional).length;
    lines.push(`${d}: ${ds.length} schools, ${ds.filter((s) => s.men === true).length} men's programs, ${ds.filter((s) => s.women === true).length} women's programs, ${both} schools with both (${ds.filter((s) => s.men === undefined || s.women === undefined).length} with a program flag unknown${prov ? `, ${prov} provisional members` : ""})`);
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
