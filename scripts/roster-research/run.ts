/**
 * Roster research collector (research tooling only: touches no app code, no database, no Supabase).
 *
 *   ROSTER_CONTACT_EMAIL=you@example.com node --experimental-strip-types scripts/roster-research/run.ts --phase 1
 *
 * Phases:  1 pilot (D3, NESCAC, 2026)   2 (D3 + D2 + JUCO, 2026)   3 (2022, then 2018, then 2014; all divisions)
 * Options: --phase N | --division D3 --season 2026 --conference NESCAC   (override the phase)
 *          --out DIR           default data/outreach/rosters   (gitignored; never commit the rows)
 *          --schools DIR       default scripts/roster-research/schools   (*.json lists of schools)
 *          --retry-failed      try again the pages that failed on the network last time
 *          --limit N           stop after N pages this run (to test)
 *          --report-only       rebuild the CSVs and the coverage log from what is already collected, fetch nothing
 *
 * Resumable: every finished page is appended to <out>/.work/outcomes.jsonl. A new run skips pages already there (ok or missing);
 * failed ones are retried only with --retry-failed. Every fetched page is cached in <out>/.cache, so nothing is fetched twice.
 * Rules: public roster pages only, robots.txt honoured, 1 request per second per host, a User-Agent with your contact email.
 * Keeps only: school, division, conference, team, season, name, class year, position, hometown city and state, source URL, date.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildCsvs, collectTask, coverageCsv, messiestRows, pendingTasks, PHASES, planTasks, summarize, taskKey, type Division, type Outcome, type School } from "./core.ts";
import { buildUserAgent, PoliteFetcher } from "./fetcher.ts";

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const flag = (n: string): boolean => process.argv.includes(n);
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};

function loadSchools(dir: string): School[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { schools: School[] }).schools);
}

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

async function main() {
  const out = resolve(arg("--out") ?? "data/outreach/rosters");
  const work = join(out, ".work");
  mkdirSync(work, { recursive: true });
  const outcomesFile = join(work, "outcomes.jsonl");

  const phase = Number(arg("--phase") ?? 0);
  const preset = PHASES[phase];
  const divisions = (arg("--division") ? [arg("--division") as Division] : preset?.divisions) ?? fail("Pass --phase 1|2|3, or --division and --season.");
  const seasons = (arg("--season") ? [Number(arg("--season"))] : preset?.seasons) ?? fail("Pass --season.");
  const conference = arg("--conference") ?? preset?.conference;

  const schools = loadSchools(resolve(arg("--schools") ?? "scripts/roster-research/schools"));
  const tasks = planTasks(schools, { divisions, seasons, conference });
  console.log(`Plan: ${tasks.length} pages (${new Set(tasks.map((t) => t.school.id)).size} schools) for ${divisions.join("/")} ${seasons.join(", ")}${conference ? ` ${conference}` : ""}`);
  if (tasks.length === 0) fail(`No schools match. Add school lists to ${arg("--schools") ?? "scripts/roster-research/schools"}.`);

  const done = loadOutcomes(outcomesFile);
  if (!flag("--report-only")) {
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
  writeFileSync(join(out, `coverage_${divisions.join("-")}_${seasons.join("-")}.csv`), coverageCsv(mine));
  const s = summarize(mine);
  console.log("\n=== Coverage ===");
  console.log(`Schools attempted: ${s.schools}   pages planned: ${tasks.length}   pages found: ${s.pagesFound}   not found: ${s.missing}   network failures: ${s.failed}`);
  console.log(`Rows kept: ${s.rowsKept}   skipped, not a target state: ${s.skippedNonTarget}   skipped, foreign or unreadable hometown: ${s.skippedUnreadable}   parse failures: ${s.parseFailures}`);
  console.log(`Pending: ${tasks.length - mine.length}`);
  const bad = mine.filter((o) => o.status !== "ok");
  for (const o of bad.slice(0, 40)) console.log(`  ${o.status}: ${o.school} ${o.team} ${o.season}${o.error ? ` (${o.error})` : ""}`);
  console.log("\n=== 10 messiest rows (local only; names are not committed) ===");
  for (const m of messiestRows(mine)) console.log(`  [${m.score}] ${m.school} ${m.team} ${m.season}: "${m.name}" / "${m.hometown_raw}"`);
}

void main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
