import { parseRosterHtml } from "./sidearm.ts";
import { isTargetState } from "./states.ts";
import { waybackUrl, type FetchResult } from "./fetcher.ts";
import type { Platform, RosterInfo } from "./platform.ts";

/** The collection plan, one page at a time, and how a page becomes rows. No network here: the fetcher is passed in. */

export type Division = "D1" | "D2" | "D3" | "JUCO";
export type Team = "men" | "women";
export type School = {
  id: string; school: string;
  /** The same text as `school`, kept so either property name reads the display name. */
  name?: string; division: Division; conference: string; base: string;
  /** From the school list builder; hand-written entries may lack them. */
  state?: string;
  men?: boolean;
  women?: boolean;
  platform?: Platform;
  source?: string;
  roster?: RosterInfo;
};
export type Task = { school: School; team: Team; season: number };

/** Seasons we collect. D1 2023-2026 are already held elsewhere. */
export const SEASONS_2026 = [2026];
export const SEASONS_BACK = [2022, 2018, 2014];
export const D1_HELD_SEASONS = [2023, 2024, 2025, 2026];

export const taskKey = (t: Task): string => `${t.school.id}|${t.team}|${t.season}`;

export type Skip = { school: string; division: Division; conference: string; team: Team; season: number; reason: string };

/** Why a school's pages are not fetched, or null when they are. Sidearm-pattern or verified roster addresses are fetched; the rest are skipped. */
export function skipReason(s: School): string | null {
  const r = s.roster;
  if (r?.status === "needs_review") return `needs_review: ${r.reason || "roster address not verified"}`;
  if (r?.status === "unsupported_platform") return `unsupported_platform: ${r.reason}`;
  if (r?.status === "verified") return null;
  // Not checked yet (hand-written lists, or a list built with --skip-verify): fetch only if it is known or assumed to be Sidearm.
  if (!s.platform || s.platform === "sidearm") return s.base ? null : "no athletics website address";
  return `unsupported_platform: ${s.platform}`;
}

export type Plan = { tasks: Task[]; skipped: Skip[] };

/** The pages to fetch, plus the programs that were left out and why (they go in the coverage log). Programs a school does not have are not planned. */
export function planWithSkips(schools: School[], opts: { divisions: Division[]; seasons: number[]; conference?: string; state?: string }): Plan {
  const tasks: Task[] = [];
  const skipped: Skip[] = [];
  for (const season of opts.seasons)
    for (const s of schools) {
      if (!opts.divisions.includes(s.division)) continue;
      if (opts.conference && s.conference.toLowerCase() !== opts.conference.toLowerCase()) continue;
      if (opts.state && (s.state ?? "").toUpperCase() !== opts.state.toUpperCase()) continue;
      const why = skipReason(s);
      for (const team of ["men", "women"] as Team[]) {
        if ((team === "men" ? s.men : s.women) === false) continue;
        if (why) skipped.push({ school: s.school, division: s.division, conference: s.conference, team, season, reason: why });
        else tasks.push({ school: s, team, season });
      }
    }
  return { tasks, skipped };
}

export function planTasks(schools: School[], opts: { divisions: Division[]; seasons: number[]; conference?: string; state?: string }): Task[] {
  return planWithSkips(schools, opts).tasks;
}

export const PHASES: Record<number, { divisions: Division[]; seasons: number[]; conference?: string }> = {
  1: { divisions: ["D3"], seasons: [2026], conference: "NESCAC" },
  2: { divisions: ["D3", "D2", "JUCO"], seasons: [2026] },
  3: { divisions: ["D1", "D2", "D3", "JUCO"], seasons: [2022, 2018, 2014] },
};

/** Candidate roster URLs for a task, best first. The current season's page has no year in some sites, so it is tried last. */
export function candidateUrls(t: Task, currentSeason = 2026): string[] {
  const slug = t.team === "men" ? "mens-soccer" : "womens-soccer"; // Sidearm pattern: the only one the parser reads
  const base = `${t.school.base.replace(/\/+$/, "")}/sports/${slug}/roster`;
  const yy = String(t.season + 1).slice(2);
  const direct = [`${base}/${t.season}`, `${base}/${t.season}-${yy}`];
  const urls = [...direct];
  if (t.season === currentSeason) urls.push(base);
  // Seasons before 2025: the live site first (above), then the Wayback Machine (2 seconds between requests, 30 second timeout).
  if (t.season < 2025) for (const u of direct) urls.push(waybackUrl(t.season, u));
  return urls;
}

export type Row = {
  school: string; division: Division; conference: string; team: Team; season: number; name: string; class_year: string; position: string;
  hometown_city: string; hometown_state: string; source_url: string; collected_at: string; duplicate_of_existing: string;
};
export const CSV_COLUMNS: (keyof Row)[] = ["school", "division", "conference", "team", "season", "name", "class_year", "position", "hometown_city", "hometown_state", "source_url", "collected_at", "duplicate_of_existing"];

export type Outcome = {
  key: string;
  school: string; division: Division; conference: string; team: Team; season: number;
  status: "ok" | "missing" | "failed";
  urls_tried: string[];
  source_url: string;
  format: string;
  players_on_page: number;
  rows_kept: number;
  skipped_non_target: number;
  skipped_foreign_or_unreadable: number;
  parse_failures: number;
  failure_notes: string[];
  error: string;
  /** Kept rows only. */
  rows: Row[];
  /**
   * The RAW hometown text (city and state as published, nothing after a "/") of every player skipped as foreign or unreadable. No
   * names, no high schools. Absent in work files written before this field existed (re-parse them with --reparse).
   */
  skipped_raw?: string[];
  /** The raw hometown text of kept rows, with whether a "/" part was dropped, for the "most unusual strings" list. */
  kept_raw?: { raw: string; had_extra: boolean }[];
};

export type Getter = { get(url: string): Promise<FetchResult> };

/** Looks for the roster page, parses it and keeps only players whose hometown is in a target state. Never guesses a hometown. */
export async function collectTask(t: Task, fetcher: Getter, nowIso: string): Promise<Outcome> {
  const base: Outcome = {
    key: taskKey(t), school: t.school.school, division: t.school.division, conference: t.school.conference, team: t.team, season: t.season,
    status: "missing", urls_tried: [], source_url: "", format: "", players_on_page: 0, rows_kept: 0, skipped_non_target: 0,
    skipped_foreign_or_unreadable: 0, parse_failures: 0, failure_notes: [], error: "", rows: [], skipped_raw: [], kept_raw: [],
  };
  let sawTransientFailure = false;
  for (const url of candidateUrls(t)) {
    const res = await fetcher.get(url);
    base.urls_tried.push(url);
    if (res.error || res.status === 0 || res.status >= 500 || res.status === 429) {
      sawTransientFailure = true;
      base.error = res.error ?? `HTTP ${res.status}`;
      if (res.blockedByRobots) sawTransientFailure = false;
      continue;
    }
    if (res.status !== 200) continue;
    const parsed = parseRosterHtml(res.body);
    if (parsed.players.length === 0) {
      base.failure_notes.push(...parsed.failures.slice(0, 3).map((f) => `${url}: ${f}`));
      continue;
    }
    base.status = "ok";
    base.source_url = url;
    base.format = parsed.format;
    base.players_on_page = parsed.players.length;
    base.parse_failures = parsed.failures.length;
    base.failure_notes.push(...parsed.failures.slice(0, 5));
    const seen = new Set<string>();
    for (const p of parsed.players) {
      if (!p.hometownRaw || !p.hometown.state) {
        base.skipped_foreign_or_unreadable++;
        base.skipped_raw!.push(p.hometownRaw);
        continue;
      }
      if (!isTargetState(p.hometown.state)) {
        base.skipped_non_target++;
        continue;
      }
      const dedupe = `${p.name.toLowerCase()}|${p.classYear}|${p.hometown.city.toLowerCase()}|${p.hometown.state}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      base.kept_raw!.push({ raw: p.hometownRaw, had_extra: p.hadExtra });
      base.rows.push({
        school: t.school.school, division: t.school.division, conference: t.school.conference, team: t.team, season: t.season, name: p.name,
        class_year: p.classYear, position: p.position, hometown_city: p.hometown.city, hometown_state: p.hometown.state, source_url: url, collected_at: nowIso,
        duplicate_of_existing: t.school.division === "D1" && D1_HELD_SEASONS.includes(t.season) ? "true" : "",
      });
    }
    base.rows_kept = base.rows.length;
    return base;
  }
  base.status = sawTransientFailure ? "failed" : "missing";
  return base;
}

/** Pages still to do: not collected yet, or failed on the network last time and --retry-failed was given. Order is kept. */
export function pendingTasks(tasks: Task[], done: ReadonlyMap<string, Outcome>, retryFailed: boolean): Task[] {
  return tasks.filter((t) => {
    const prior = done.get(taskKey(t));
    return !prior || (prior.status === "failed" && retryFailed);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// CSV and coverage
// ---------------------------------------------------------------------------------------------------------------------------

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows grouped into one CSV per division-season, deduped within the season (same school, team, name, class, hometown). */
export function buildCsvs(outcomes: Outcome[]): Map<string, string> {
  const groups = new Map<string, Row[]>();
  for (const o of outcomes) {
    if (o.status !== "ok") continue;
    const k = `${o.division}_${o.season}`;
    groups.set(k, [...(groups.get(k) ?? []), ...o.rows]);
  }
  const out = new Map<string, string>();
  for (const [k, rows] of groups) {
    const seen = new Set<string>();
    const kept: Row[] = [];
    for (const r of rows) {
      const d = [r.school, r.team, r.season, r.name.toLowerCase(), r.class_year, r.hometown_city.toLowerCase(), r.hometown_state].join("|");
      if (seen.has(d)) continue;
      seen.add(d);
      kept.push(r);
    }
    kept.sort((a, b) => a.school.localeCompare(b.school) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    out.set(`${k}.csv`, [CSV_COLUMNS.join(","), ...kept.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n");
  }
  return out;
}

export const COVERAGE_COLUMNS = ["school", "division", "conference", "team", "season", "status", "source_url", "format", "players_on_page", "rows_kept", "skipped_non_target", "skipped_foreign_or_unreadable", "parse_failures", "urls_tried", "error"] as const;

export function coverageCsv(outcomes: Outcome[]): string {
  const lines = outcomes.map((o) => COVERAGE_COLUMNS.map((c) => csvCell(c === "urls_tried" ? o.urls_tried.join(" ") : (o as unknown as Record<string, unknown>)[c])).join(","));
  return [COVERAGE_COLUMNS.join(","), ...lines].join("\n") + "\n";
}

export type Summary = { tasks: number; schools: number; pagesFound: number; missing: number; failed: number; rowsKept: number; skippedNonTarget: number; skippedUnreadable: number; parseFailures: number };
/** The coverage log plus a row for every program that was skipped, with the reason. */
export function coverageCsvWithSkips(outcomes: Outcome[], skipped: Skip[]): string {
  const base = coverageCsv(outcomes).trimEnd().split("\n");
  const rows = skipped.map((k) => COVERAGE_COLUMNS.map((c) => csvCell({ school: k.school, division: k.division, conference: k.conference, team: k.team, season: k.season, status: "skipped", error: k.reason }[c as string] ?? "")).join(","));
  return [...base, ...rows].join("\n") + "\n";
}

export function summarize(outcomes: Outcome[]): Summary {
  return {
    tasks: outcomes.length,
    schools: new Set(outcomes.map((o) => o.school)).size,
    pagesFound: outcomes.filter((o) => o.status === "ok").length,
    missing: outcomes.filter((o) => o.status === "missing").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    rowsKept: outcomes.reduce((n, o) => n + o.rows_kept, 0),
    skippedNonTarget: outcomes.reduce((n, o) => n + o.skipped_non_target, 0),
    skippedUnreadable: outcomes.reduce((n, o) => n + o.skipped_foreign_or_unreadable, 0),
    parseFailures: outcomes.reduce((n, o) => n + o.parse_failures, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reports from the local work file (no names, no high schools: only the hometown text as published)
// ---------------------------------------------------------------------------------------------------------------------------

/** How unusual a hometown string is: extra punctuation, a "/" part, parentheses, digits, odd length or case. Higher is stranger. */
export function unusualScore(raw: string, hadExtra: boolean): number {
  let n = 0;
  if (hadExtra) n += 3;
  if (/[()[\]]/.test(raw)) n += 3;
  if (/\d/.test(raw)) n += 2;
  if (/[^A-Za-z .,'\u2019-]/.test(raw)) n += 2;
  if ((raw.match(/,/g) ?? []).length > 1) n += 2;
  if (/[.,]\s*$/.test(raw.replace(/\.$/, "")) || /,\s*$/.test(raw)) n += 1;
  if (raw.length > 30) n += 2;
  if (raw.length > 0 && raw === raw.toUpperCase() && /[A-Z]{4}/.test(raw)) n += 1;
  if (/\s{2,}/.test(raw)) n += 1;
  return n;
}

export type SkippedGroup = { raw: string; count: number; where: { school: string; season: number; count: number }[] };

/** Players skipped as foreign or unreadable, grouped by distinct raw hometown text, most common first. */
export function skippedGroups(outcomes: Outcome[]): SkippedGroup[] {
  const m = new Map<string, Map<string, { school: string; season: number; count: number }>>();
  for (const o of outcomes) {
    for (const raw of o.skipped_raw ?? []) {
      const g = m.get(raw) ?? new Map();
      const k = `${o.school}|${o.season}`;
      const cur = g.get(k) ?? { school: o.school, season: o.season, count: 0 };
      cur.count++;
      g.set(k, cur);
      m.set(raw, g);
    }
  }
  return [...m.entries()]
    .map(([raw, g]) => ({ raw, count: [...g.values()].reduce((n, x) => n + x.count, 0), where: [...g.values()].sort((a, b) => b.count - a.count || a.school.localeCompare(b.school)) }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
}

/** The most unusual raw hometown strings among rows that were kept (distinct strings, with how many times each appeared). */
export function unusualKept(outcomes: Outcome[], n = 10): { raw: string; had_extra: boolean; score: number; count: number }[] {
  const m = new Map<string, { raw: string; had_extra: boolean; score: number; count: number }>();
  for (const o of outcomes)
    for (const k of o.kept_raw ?? []) {
      const key = `${k.raw}|${k.had_extra}`;
      const cur = m.get(key) ?? { raw: k.raw, had_extra: k.had_extra, score: unusualScore(k.raw, k.had_extra), count: 0 };
      cur.count++;
      m.set(key, cur);
    }
  return [...m.values()].filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.count - a.count || a.raw.localeCompare(b.raw)).slice(0, n);
}

export function skippedReport(outcomes: Outcome[]): string[] {
  const lines: string[] = [];
  const groups = skippedGroups(outcomes);
  const total = groups.reduce((n, g) => n + g.count, 0);
  const missing = outcomes.filter((o) => o.status === "ok" && o.skipped_raw === undefined).length;
  lines.push(`=== Skipped as foreign or unreadable: ${total} players, ${groups.length} distinct hometown texts (raw text only, no names) ===`);
  if (missing) lines.push(`  (${missing} pages were collected before raw text was saved: run again with --reparse to fill them in from the cache, no fetching)`);
  for (const g of groups) {
    const where = g.where.slice(0, 4).map((w) => `${w.school} ${w.season}${w.count > 1 ? ` x${w.count}` : ""}`).join("; ") + (g.where.length > 4 ? `; +${g.where.length - 4} more` : "");
    lines.push(`  ${String(g.count).padStart(3)}  ${g.raw === "" ? "(empty hometown)" : JSON.stringify(g.raw)}  [${where}]`);
  }
  lines.push("");
  lines.push("=== 10 most unusual raw hometown strings among KEPT rows ===");
  const odd = unusualKept(outcomes);
  if (odd.length === 0) lines.push("  (none: every kept hometown was plain 'City, State')");
  for (const x of odd) lines.push(`  [${x.score}] x${x.count}  ${JSON.stringify(x.raw)}${x.had_extra ? "   (a '/' part was dropped)" : ""}`);
  return lines;
}
