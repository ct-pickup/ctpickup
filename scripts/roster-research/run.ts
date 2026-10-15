/**
 * Roster research collector (research tooling only: touches no app code, no database, no Supabase).
 *
 *   ROSTER_CONTACT_EMAIL=you@example.com node --experimental-strip-types scripts/roster-research/run.ts --phase 1
 *
 * Phases:  1 pilot (D3, NESCAC, 2026)   2 (D3 + D2 + JUCO, 2026)   3 (2022, then 2018, then 2014; all divisions)
 * Options: --phase N | --division D3 --season 2026 --conference NESCAC   (override the phase)
 *          --build-schools     build schools/d1.json d2.json d3.json juco.json: every men's and women's soccer program, the athletics site's
 *                              platform, and a check of each Sidearm roster address (one request per program, cached). Needs the contact
 *                              email. Options: --division D3 (one division), --limit N (check only N schools), --skip-verify (lists only),
 *                              --refresh (check everything again). Reads schools/sources.json and schools/overrides.json.
 *          --debug-source ncaa  offline: describe the cached NCAA directory responses (field names, division and sport values with
 *                              counts, distinct schools, 5 sample records). Reads cached pages only; no player data, no network.
 *          --lists-only        with --build-schools: write the lists only (no home-page or roster checks), fast and offline when cached
 *          --list-needs-review print every school whose roster address could not be used: name, division and reason (no network)
 *          --state CT          only schools in this state (the school's state, not the players')
 *          --out DIR           default data/outreach/rosters   (gitignored; never commit the rows)
 *          --schools DIR       default scripts/roster-research/schools   (*.json lists of schools)
 *          --retry-failed      try again the pages that failed on the network last time
 *          --limit N           stop after N pages this run (to test)
 *          --report-only       rebuild the CSVs and the coverage log from what is already collected, fetch nothing
 *          --show-skipped      print, from the local work file only (no fetching), every hometown text skipped as foreign or
 *                              unreadable (grouped, with school and season, no names) and the 10 most unusual kept strings
 *          --export-outreach   write <out>/outreach_list.csv (one row per player, sorted CT, NY, NJ, MA, MD, PA, DC, DE, RI; newest
 *                              season first) and <out>/outreach_unsplit.csv from the CSVs already collected. Offline. Add
 *                              --include-duplicate-of-existing to keep D1 rows flagged as already held. Local file for use by hand.
 *          --reparse           re-read every already-fetched page from the cache (never the network) with the current parser and
 *                              refresh the work file. Use it after a parser fix, or to add raw hometown text to older work files
 *
 * Resumable: every finished page is appended to <out>/.work/outcomes.jsonl. A new run skips pages already there (ok or missing);
 * failed ones are retried only with --retry-failed. Every fetched page is cached in <out>/.cache, so nothing is fetched twice.
 * Rules: public roster pages only, robots.txt honoured, 1 request per second per host, a User-Agent with your contact email.
 * Keeps only: school, division, conference, team, season, name, class year, position, hometown city and state, source URL, date.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildCsvs, collectTask, coverageCsvWithSkips, pendingTasks, skippedReport, PHASES, planWithSkips, summarize, taskKey, type Division, type Outcome } from "./core.ts";
import { buildUserAgent, PoliteFetcher } from "./fetcher.ts";
import { debugNcaaCache } from "./debugSource.ts";
import { buildSchoolLists, loadSchoolFiles, needsReviewLines, schoolReport, type Overrides, type SourcesConfig } from "./schoolList.ts";
import { buildOutreach, outreachCsv, outreachSummary, unsplitCsv } from "./outreach.ts";
import { parseCsv } from "../lib/researchImport.ts";
import type { Row } from "./core.ts";

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const flag = (n: string): boolean => process.argv.includes(n);
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};

function loadOutcomes(file: string): Map<string, Outcome> {
  const m = new Map<string, Outcome>();
  if (!existsSync(file)) return m;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Outcome;
      m.set(o.key, o); // a later line for the same page (a retry) wins
    } catch {
      /* a half-written last line from a crash: ignore, that page is simply redone */
    }
  }
  return m;
}

/** Reads the collected division-season CSVs in the output folder and writes the outreach list. Touches no network. */
function exportOutreach(out: string): void {
  const files = readdirSync(out).filter((f) => /^(D1|D2|D3|JUCO)_\d{4}\.csv$/.test(f));
  if (files.length === 0) fail(`No collected CSVs (D3_2026.csv and so on) in ${out}. Run a phase first.`);
  const rows: Row[] = [];
  for (const f of files) {
    const [head, ...body] = parseCsv(readFileSync(join(out, f), "utf8"));
    for (const cells of body) rows.push(Object.fromEntries(head!.map((h, i) => [h, cells[i] ?? ""])) as unknown as Row);
  }
  const built = buildOutreach(rows, { includeDuplicateOfExisting: flag("--include-duplicate-of-existing") });
  writeFileSync(join(out, "outreach_list.csv"), outreachCsv(built.rows));
  writeFileSync(join(out, "outreach_unsplit.csv"), unsplitCsv(built.unsplit));
  console.log(`Read ${rows.length} rows from ${files.length} files: ${files.join(", ")}`);
  for (const line of outreachSummary(built)) console.log(line);
  for (const u of built.unsplit.slice(0, 20)) console.log(`  not split (${u.reason}): "${u.name}" at ${u.school} ${u.season}, hometown ${u.hometown_city}, ${u.hometown_state}`);
  console.log(`Wrote ${join(out, "outreach_list.csv")} and outreach_unsplit.csv (local files, gitignored).`);
}

async function main() {
  const out = resolve(arg("--out") ?? "data/outreach/rosters");
  const work = join(out, ".work");
  mkdirSync(work, { recursive: true });
  const outcomesFile = join(work, "outcomes.jsonl");

  if (flag("--export-outreach")) {
    exportOutreach(out);
    return;
  }

  const schoolsDir = resolve(arg("--schools") ?? "scripts/roster-research/schools");

  if (arg("--debug-source")) {
    if (arg("--debug-source") !== "ncaa") fail("--debug-source takes: ncaa");
    let host = "web3.ncaa.org";
    try {
      const url = (JSON.parse(readFileSync(join(schoolsDir, "sources.json"), "utf8")) as SourcesConfig).ncaa?.url;
      if (url) host = new URL(url.replace(/\{\w+\}/g, "x")).hostname;
    } catch {
      /* keep the default host */
    }
    for (const l of debugNcaaCache(join(out, ".cache"), host)) console.log(l);
    return;
  }
  if (flag("--list-needs-review")) {
    const lines = needsReviewLines(loadSchoolFiles(schoolsDir), arg("--division") ?? undefined);
    for (const l of lines) console.log(l);
    console.log(`${lines.length} schools need review or use an unsupported platform.`);
    return;
  }
  if (flag("--build-schools")) {
    const readJson = <T,>(f: string, fallback: T): T => {
      try {
        return JSON.parse(readFileSync(join(schoolsDir, f), "utf8")) as T;
      } catch {
        return fallback;
      }
    };
    const fetcher = new PoliteFetcher({ cacheDir: join(out, ".cache"), userAgent: buildUserAgent(process.env.ROSTER_CONTACT_EMAIL) });
    const only = arg("--division") as Division | null;
    const all = await buildSchoolLists({
      dir: schoolsDir, sources: readJson<SourcesConfig>("sources.json", {}), overrides: readJson<Overrides>("overrides.json", {}), fetcher,
      divisions: only ? [only] : ["D1", "D2", "D3", "JUCO"], season: Number(arg("--season") ?? 2025), nowIso: new Date().toISOString(),
      refresh: flag("--refresh"), verify: !flag("--skip-verify"), listsOnly: flag("--lists-only"), limit: arg("--limit") ? Number(arg("--limit")) : undefined, log: (l) => console.log(l),
    });
    console.log("");
    for (const l of schoolReport(all.schools)) console.log(l);
    const st = all.stats;
    console.log(`Dropped while building: ${st.otherDivisionSchools} schools in another division (${st.otherDivisionRows} rows), division unknown: ${st.divisionUnknownSchools} schools (${st.divisionUnknownRows} rows), rows with no soccer program: ${st.notSoccerRows}, stale entries from an earlier build removed: ${st.staleRemoved}`);
    console.log(`\nNetwork requests this run: ${fetcher.requests.length}. Pages already cached were not fetched again. See the schools that need review with --list-needs-review.`);
    return;
  }

  const phase = Number(arg("--phase") ?? 0);
  const preset = PHASES[phase];
  const divisions = (arg("--division") ? [arg("--division") as Division] : preset?.divisions) ?? fail("Pass --phase 1|2|3, or --division and --season.");
  const seasons = (arg("--season") ? [Number(arg("--season"))] : preset?.seasons) ?? fail("Pass --season.");
  const conference = arg("--conference") ?? preset?.conference;

  const schools = loadSchoolFiles(schoolsDir);
  const { tasks, skipped } = planWithSkips(schools, { divisions, seasons, conference, state: arg("--state") ?? undefined });
  console.log(`Plan: ${tasks.length} pages (${new Set(tasks.map((t) => t.school.id)).size} schools) for ${divisions.join("/")} ${seasons.join(", ")}${conference ? ` ${conference}` : ""}${arg("--state") ? ` in ${arg("--state")}` : ""}; ${skipped.length} programs skipped (see the coverage log)`);
  if (tasks.length === 0) fail(`No schools match. Build the lists with --build-schools, or add school lists to ${schoolsDir}.`);

  const done = loadOutcomes(outcomesFile);
  const offlineOnly = flag("--report-only") || flag("--show-skipped");
  if (flag("--reparse")) {
    // Only pages already in the cache are read; nothing goes to the network. A better result replaces the old one; a page that
    // is not in the cache leaves the old result alone.
    const cache = new PoliteFetcher({ cacheDir: join(out, ".cache"), userAgent: "offline", offline: true });
    let refreshed = 0;
    for (const t of tasks) {
      const o = await collectTask(t, cache, new Date().toISOString());
      if (o.status !== "ok") continue;
      appendFileSync(outcomesFile, JSON.stringify(o) + "\n");
      done.set(o.key, o);
      refreshed++;
    }
    console.log(`Re-parsed ${refreshed} of ${tasks.length} pages from the cache (no network).`);
  } else if (!offlineOnly) {
    const fetcher = new PoliteFetcher({ cacheDir: join(out, ".cache"), userAgent: buildUserAgent(process.env.ROSTER_CONTACT_EMAIL) });
    const limit = Number(arg("--limit") ?? Infinity);
    const started = Date.now();
    let n = 0;
    for (const t of pendingTasks(tasks, done, flag("--retry-failed"))) {
      if (n >= limit) break;
      const o = await collectTask(t, fetcher, new Date().toISOString());
      appendFileSync(outcomesFile, JSON.stringify(o) + "\n");
      done.set(o.key, o);
      n++;
      console.log(`${o.status.padEnd(7)} ${o.school} ${o.team} ${o.season}  kept ${o.rows_kept}  (${o.players_on_page} on page)${o.error ? `  ${o.error}` : ""}`);
    }
    console.log(`Fetched ${fetcher.requests.length} pages over the network in ${Math.round((Date.now() - started) / 1000)}s (the rest came from the cache).`);
  }

  // Build the CSVs and the coverage log from everything collected for the planned pages.
  const mine = tasks.map((t) => done.get(taskKey(t))).filter((o): o is Outcome => !!o);
  for (const [name, csv] of buildCsvs(mine)) writeFileSync(join(out, name), csv);
  writeFileSync(join(out, `coverage_${divisions.join("-")}_${seasons.join("-")}.csv`), coverageCsvWithSkips(mine, skipped));
  const s = summarize(mine);
  console.log("\n=== Coverage ===");
  console.log(`Schools attempted: ${s.schools}   pages planned: ${tasks.length}   pages found: ${s.pagesFound}   not found: ${s.missing}   network failures: ${s.failed}`);
  console.log(`Rows kept: ${s.rowsKept}   skipped, not a target state: ${s.skippedNonTarget}   skipped, foreign or unreadable hometown: ${s.skippedUnreadable}   parse failures: ${s.parseFailures}`);
  console.log(`Pending: ${tasks.length - mine.length}   skipped programs (no usable roster address or platform): ${skipped.length}`);
  const skipGroups = new Map<string, number>();
  for (const k of skipped) {
    const label = k.reason.length > 60 ? `${k.reason.slice(0, 60)}...` : k.reason;
    skipGroups.set(label, (skipGroups.get(label) ?? 0) + 1);
  }
  for (const [r, n] of [...skipGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  skipped ${n}: ${r}`);
  const bad = mine.filter((o) => o.status !== "ok");
  for (const o of bad.slice(0, 40)) console.log(`  ${o.status}: ${o.school} ${o.team} ${o.season}${o.error ? ` (${o.error})` : ""}`);
  console.log("");
  for (const line of skippedReport(mine)) console.log(line);
}

void main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
