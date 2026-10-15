import { messiness, parseRosterHtml } from "./sidearm.ts";
import { isTargetState } from "./states.ts";
import { waybackUrl, type FetchResult } from "./fetcher.ts";

/** The collection plan, one page at a time, and how a page becomes rows. No network here: the fetcher is passed in. */

export type Division = "D1" | "D2" | "D3" | "JUCO";
export type Team = "men" | "women";
export type School = { id: string; school: string; division: Division; conference: string; base: string };
export type Task = { school: School; team: Team; season: number };

/** Seasons we collect. D1 2023-2026 are already held elsewhere. */
export const SEASONS_2026 = [2026];
export const SEASONS_BACK = [2022, 2018, 2014];
export const D1_HELD_SEASONS = [2023, 2024, 2025, 2026];

export const taskKey = (t: Task): string => `${t.school.id}|${t.team}|${t.season}`;

export function planTasks(schools: School[], opts: { divisions: Division[]; seasons: number[]; conference?: string }): Task[] {
  const out: Task[] = [];
  for (const season of opts.seasons)
    for (const s of schools) {
      if (!opts.divisions.includes(s.division)) continue;
      if (opts.conference && s.conference.toLowerCase() !== opts.conference.toLowerCase()) continue;
      // D1 is only collected for the seasons we do not already hold, unless asked for explicitly by listing the season.
      for (const team of ["men", "women"] as Team[]) out.push({ school: s, team, season });
    }
  return out;
}

export const PHASES: Record<number, { divisions: Division[]; seasons: number[]; conference?: string }> = {
  1: { divisions: ["D3"], seasons: [2026], conference: "NESCAC" },
  2: { divisions: ["D3", "D2", "JUCO"], seasons: [2026] },
  3: { divisions: ["D1", "D2", "D3", "JUCO"], seasons: [2022, 2018, 2014] },
};

/** Candidate roster URLs for a task, best first. The current season's page has no year in some sites, so it is tried last. */
export function candidateUrls(t: Task, currentSeason = 2026): string[] {
  const slug = t.team === "men" ? "mens-soccer" : "womens-soccer";
  const base = `${t.school.base.replace(/\/+$/, "")}/sports/${slug}/roster`;
  const yy = String(t.season + 1).slice(2);
  const direct = [`${base}/${t.season}`, `${base}/${t.season}-${yy}`];
  const urls = [...direct];
  if (t.season === currentSeason) urls.push(base);
  // Older seasons often only survive in the Wayback Machine.
  if (t.season < currentSeason) for (const u of direct) urls.push(waybackUrl(t.season, u));
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
  /** For the "messiest rows" report: the raw text of the hometown cell and a score. Stays in the local work files. */
  messy: { name: string; hometown_raw: string; score: number; school: string; team: Team; season: number }[];
};

export type Getter = { get(url: string): Promise<FetchResult> };

/** Looks for the roster page, parses it and keeps only players whose hometown is in a target state. Never guesses a hometown. */
export async function collectTask(t: Task, fetcher: Getter, nowIso: string): Promise<Outcome> {
  const base: Outcome = {
    key: taskKey(t), school: t.school.school, division: t.school.division, conference: t.school.conference, team: t.team, season: t.season,
    status: "missing", urls_tried: [], source_url: "", format: "", players_on_page: 0, rows_kept: 0, skipped_non_target: 0,
    skipped_foreign_or_unreadable: 0, parse_failures: 0, failure_notes: [], error: "", rows: [], messy: [],
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
      const score = messiness(p);
      if (score >= 2) base.messy.push({ name: p.name, hometown_raw: p.hometownRaw, score, school: t.school.school, team: t.team, season: t.season });
      if (!p.hometownRaw) {
        base.skipped_foreign_or_unreadable++;
        continue;
      }
      if (!p.hometown.state) {
        base.skipped_foreign_or_unreadable++;
        continue;
      }
      if (!isTargetState(p.hometown.state)) {
        base.skipped_non_target++;
        continue;
      }
      const dedupe = `${p.name.toLowerCase()}|${p.classYear}|${p.hometown.city.toLowerCase()}|${p.hometown.state}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
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

export function messiestRows(outcomes: Outcome[], n = 10) {
  return outcomes.flatMap((o) => o.messy).sort((a, b) => b.score - a.score).slice(0, n);
}
