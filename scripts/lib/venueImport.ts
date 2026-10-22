/**
 * Nationwide venue import: reads a SQLite snapshot and sends it, state by state, through public.upsert_schools and
 * public.upsert_venues. Pure of env and secrets: the caller passes an `rpc` function. Used by scripts/import-venues.ts.
 */
import { spawnSync } from "node:child_process";

import { chunk, normalizeSchool, normalizeVenue, type NormalizeResult } from "./ctImport.ts";

export type Row = Record<string, unknown>;

/** Read-only access to the snapshot. */
export type SqliteSource = {
  kind: "node:sqlite" | "sqlite3 CLI";
  all(sql: string): Row[];
  close(): void;
};

const STATE_RE = /^[A-Z]{2}$/;

/** `sqlite3 -json` prints nothing at all for zero rows. */
export function parseSqliteJson(text: string): Row[] {
  const t = text.trim();
  if (!t) return [];
  const j = JSON.parse(t) as unknown;
  if (!Array.isArray(j)) throw new Error("sqlite3 -json did not return an array");
  return j as Row[];
}

/** Opens the snapshot read-only: Node's built-in sqlite when this Node has it, otherwise the sqlite3 command-line tool. */
export async function openSqlite(path: string): Promise<SqliteSource> {
  try {
    // The module name is a variable so TypeScript does not need type declarations for the (experimental) built-in.
    const name = "node:sqlite";
    const mod = (await import(name)) as { DatabaseSync: new (p: string) => { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void } };
    const db = new mod.DatabaseSync(path);
    db.exec("PRAGMA query_only = ON");
    return {
      kind: "node:sqlite",
      all: (sql) => db.prepare(sql).all() as Row[],
      close: () => db.close(),
    };
  } catch {
    // Fall through to the CLI below.
  }
  const probe = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new Error("This Node has no built-in sqlite (needs Node 22.5 or newer) and the sqlite3 command was not found. Update Node, or install sqlite3 (brew install sqlite).");
  }
  return {
    kind: "sqlite3 CLI",
    all: (sql) => {
      const r = spawnSync("sqlite3", ["-readonly", "-json", path, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`sqlite3 failed: ${(r.stderr || "").trim().slice(0, 300)}`);
      return parseSqliteJson(r.stdout);
    },
    close: () => {},
  };
}

/** Every state code that appears in venues or schools. */
export function listStates(src: SqliteSource): string[] {
  const rows = src.all("select state from venues where state is not null union select state from schools where state is not null order by 1");
  return rows.map((r) => String(r.state).trim().toUpperCase()).filter((s) => STATE_RE.test(s));
}

/** "CT,ny" or "all". Returns the states to import and any that are not in the file. */
export function parseStates(arg: string | null | undefined, available: string[]): { states: string[]; unknown: string[]; error?: string } {
  const a = (arg ?? "").trim();
  if (!a) return { states: [], unknown: [], error: "Pass --states CT,NY,... or --states all." };
  if (a.toLowerCase() === "all") return { states: [...available], unknown: [] };
  const wanted = [...new Set(a.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bad = wanted.filter((s) => !STATE_RE.test(s));
  if (bad.length) return { states: [], unknown: [], error: `Not a state code: ${bad.join(", ")}` };
  return { states: wanted.filter((s) => available.includes(s)), unknown: wanted.filter((s) => !available.includes(s)) };
}

/** One state's rows from one table. The state code is validated, so it is safe to put in the SQL. */
export function readStateRows(src: SqliteSource, table: "venues" | "schools", state: string): Row[] {
  if (!STATE_RE.test(state)) throw new Error(`bad state code ${state}`);
  const key = table === "venues" ? "venue_key" : "school_key";
  return src.all(`select * from ${table} where state = '${state}' order by ${key}`);
}

export type TableOutcome = {
  read: number;
  toSend: number;
  unnamed: number;
  invalid: string[];
  inserted: number;
  updated: number;
  protected: number;
  batches: number;
};
export type StateOutcome = { state: string; venues: TableOutcome; schools: TableOutcome; sent: boolean; failed?: string };

export type Counts = { inserted: number; updated: number; protected?: number };
export type RpcFn = (fn: "upsert_schools" | "upsert_venues", rows: Row[]) => Promise<Counts>;

export type ImportOptions = {
  src: SqliteSource;
  states: string[];
  rpc: RpcFn;
  batch: number;
  dryRun: boolean;
  skipInvalid: boolean;
  only: "venues" | "schools" | "both";
  includeUnnamed: boolean;
  log: (line: string) => void;
};

function empty(): TableOutcome {
  return { read: 0, toSend: 0, unnamed: 0, invalid: [], inserted: 0, updated: 0, protected: 0, batches: 0 };
}

function prepare(raw: Row[], normalize: (r: unknown) => NormalizeResult): { rows: Row[]; unnamed: number; invalid: string[]; dedupedAway: number } {
  const rows: Row[] = [];
  const invalid: string[] = [];
  let unnamed = 0;
  raw.forEach((r, i) => {
    const res = normalize(r);
    if (res.row) rows.push(res.row);
    else if (res.skipped === "unnamed") unnamed += 1;
    else invalid.push(`row ${i}${r.venue_key ?? r.school_key ? ` (${String(r.venue_key ?? r.school_key)})` : ""}: ${res.problems.join("; ")}`);
  });
  return { rows, unnamed, invalid, dedupedAway: 0 };
}

async function send(
  fn: "upsert_schools" | "upsert_venues",
  rows: Row[],
  o: ImportOptions,
  out: TableOutcome,
  label: string,
): Promise<void> {
  const parts = chunk(rows, o.batch);
  let done = 0;
  for (const part of parts) {
    const c = await o.rpc(fn, part);
    out.inserted += c.inserted;
    out.updated += c.updated;
    out.protected += c.protected ?? 0;
    out.batches += 1;
    done += part.length;
    if (out.batches % 10 === 0 || done === rows.length) o.log(`  ${label}: ${done.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
}

/**
 * Imports the chosen states one at a time: schools, then venues. Safe to run again: both functions are upserts, and
 * upsert_venues keeps price, booking and permit data (and verified) on rows that are verified or hand-entered. A state with
 * invalid rows is skipped (reported) unless skipInvalid is set, and the run goes on to the next state. A failed batch stops the run
 * and says which state to repeat.
 */
export async function runImport(o: ImportOptions): Promise<StateOutcome[]> {
  const outcomes: StateOutcome[] = [];
  const unnamedAs = (kind: "venues" | "schools") => (o.includeUnnamed ? (kind === "venues" ? "Unnamed field" : "Unnamed school") : null);
  for (const state of o.states) {
    const res: StateOutcome = { state, venues: empty(), schools: empty(), sent: false };
    o.log(`${state}: reading`);
    const rawSchools = o.only === "venues" ? [] : readStateRows(o.src, "schools", state);
    const rawVenues = o.only === "schools" ? [] : readStateRows(o.src, "venues", state);
    res.schools.read = rawSchools.length;
    res.venues.read = rawVenues.length;
    const s = prepare(rawSchools, (r) => normalizeSchool(r, { unnamedAs: unnamedAs("schools") }));
    const v = prepare(rawVenues, (r) => normalizeVenue(r, { unnamedAs: unnamedAs("venues") }));
    res.schools.toSend = s.rows.length;
    res.schools.unnamed = s.unnamed;
    res.schools.invalid = s.invalid;
    res.venues.toSend = v.rows.length;
    res.venues.unnamed = v.unnamed;
    res.venues.invalid = v.invalid;

    const invalidCount = s.invalid.length + v.invalid.length;
    if (invalidCount > 0 && !o.skipInvalid) {
      o.log(`${state}: ${invalidCount} invalid rows, state skipped (use --skip-invalid to send the rest). First: ${[...s.invalid, ...v.invalid][0]}`);
      outcomes.push(res);
      continue;
    }
    o.log(`${state}: ${s.rows.length.toLocaleString()} schools, ${v.rows.length.toLocaleString()} venues to send (${s.unnamed} + ${v.unnamed} unnamed skipped${invalidCount ? `, ${invalidCount} invalid skipped` : ""})`);
    if (o.dryRun) {
      outcomes.push(res);
      continue;
    }
    try {
      if (o.only !== "venues") await send("upsert_schools", s.rows, o, res.schools, `${state} schools`);
      if (o.only !== "schools") await send("upsert_venues", v.rows, o, res.venues, `${state} venues`);
      res.sent = true;
    } catch (e) {
      res.failed = e instanceof Error ? e.message : "unknown error";
      outcomes.push(res);
      o.log(`${state}: FAILED after ${res.schools.batches + res.venues.batches} batches: ${res.failed}. Re-run with --states ${state} (safe to repeat).`);
      return outcomes;
    }
    o.log(`${state}: done. venues +${res.venues.inserted} new, ${res.venues.updated} updated, ${res.venues.protected} protected; schools +${res.schools.inserted} new, ${res.schools.updated} updated`);
    outcomes.push(res);
  }
  return outcomes;
}

export function totals(outcomes: StateOutcome[]) {
  const t = { states: outcomes.length, venuesSent: 0, venuesInserted: 0, venuesUpdated: 0, venuesProtected: 0, venuesUnnamed: 0, schoolsSent: 0, schoolsInserted: 0, schoolsUpdated: 0, schoolsUnnamed: 0, invalidStates: 0, failed: 0 };
  for (const o of outcomes) {
    t.venuesSent += o.venues.toSend;
    t.venuesInserted += o.venues.inserted;
    t.venuesUpdated += o.venues.updated;
    t.venuesProtected += o.venues.protected;
    t.venuesUnnamed += o.venues.unnamed;
    t.schoolsSent += o.schools.toSend;
    t.schoolsInserted += o.schools.inserted;
    t.schoolsUpdated += o.schools.updated;
    t.schoolsUnnamed += o.schools.unnamed;
    if (o.venues.invalid.length + o.schools.invalid.length > 0) t.invalidStates += 1;
    if (o.failed) t.failed += 1;
  }
  return t;
}
