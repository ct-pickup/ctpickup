/**
 * Imports researched soccer-field rows (CSV) into a DEV Supabase database. Dry run by default: it reads the venues table
 * (read only), matches every row, prints a report and writes a CSV of anything unmatched. Nothing is written until --apply.
 *
 *   # dry run (reads the venues table, writes nothing to it)
 *   SUPABASE_URL=https://<dev-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types scripts/import-research.ts --expect-host <dev-ref>.supabase.co
 *
 *   # apply
 *   ... same, plus --apply
 *
 * Input, in data/research (the part before the first underscore is the state, e.g. ct_outdoor_soccer_fields.csv):
 *   *_outdoor_soccer_fields.csv    outdoor fields (24 columns)
 *   *_soccer_facilities_*.csv      indoor / private facilities (23 columns: operator_or_chain, field_sizes, min_booking, pickup_or_dropin,
 *                                  membership_required, phone, email, website, hours...). Party or package prices are never stored as a
 *                                  field rental price; hours, minimum booking, pickup and email go in the admin notes.
 *   skip.json                      names to leave out (not soccer): ["Name", ...] or { "names": [...] }
 *
 * Options:
 *   --apply              write to the database (default is a dry run)
 *   --expect-host HOST   required: repeat the database host to confirm it is the one you mean (dev)
 *   --allow-prod         lets the run proceed when the URL looks like production (still needs --expect-host). Do not use.
 *   --dir PATH           folder with the CSV files (default data/research)
 *   --file PATH          one CSV file instead of the folder
 *   --skip PATH          the skip list (default data/research/skip.json; a missing file skips nothing)
 *   --cache PATH         geocode cache (default data/research/.geocode-cache.json)
 *   --retry-failed       look up addresses the cache remembers as "no match" again
 *   --no-db              do not read the database at all: geocode and report everything as new (no key needed)
 *   --sample N           matches to show old vs new (default 10)
 *   --out PATH           where to write the unmatched CSV (default data/research/research-unmatched.csv)
 *
 * What it does to each row: geocode the address with the free US Census geocoder (never guessed; a miss is left unmatched), match
 * it to an existing venue (within 150 m and a similar name, or within 40 m), then
 *   matched:   fill only price / permit / booking / surface / lit / field count that are empty or unknown, keep the venue's name,
 *              lock those columns from imports, and store the source, residency rule, availability and contact in the notes
 *   unmatched: insert a new venue (source manual, unverified, key research-<hash of name+address>)
 * It never sets price_source = manual and never marks anything verified, so the app shows "We're confirming".
 * The service role key is read only from SUPABASE_SERVICE_ROLE_KEY and is never printed or logged.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { checkTarget, chunk, redact } from "./lib/ctImport.ts";
import {
  cleanFacilityRow,
  cleanRow,
  csvEscape,
  describeChange,
  fillPatch,
  findMatch,
  isFacilityFile,
  isOutdoorFile,
  isSkipped,
  newVenue,
  parseSkipList,
  readFacilityCsv,
  readResearchCsv,
  RESEARCH_COLUMNS,
  stateFromFilename,
  VenueIndex,
  withNotes,
  type Clean,
  type FacilityRaw,
  type ResearchRaw,
  type Venue,
} from "./lib/researchImport.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const flag = (name: string): boolean => process.argv.includes(name);
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Geocoding (US Census, free, no key), with a cache so reruns cost nothing
// ---------------------------------------------------------------------------

type Geo = { lat: number; lon: number; matched: string } | null;
type Cache = { version: 1; entries: Record<string, Geo> };

function loadCache(path: string): Cache {
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as Cache;
    if (j && j.version === 1 && j.entries) return j;
  } catch {
    /* no cache yet */
  }
  return { version: 1, entries: {} };
}

async function census(query: string): Promise<Geo> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] } };
      const m = j.result?.addressMatches?.[0];
      return m ? { lat: Number(m.coordinates.y), lon: Number(m.coordinates.x), matched: String(m.matchedAddress) } : null;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "unknown";
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Census geocoder failed for "${query}": ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Database (PostgREST), read for matching and written only with --apply
// ---------------------------------------------------------------------------

function restFns(url: string, key: string) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const call = async (path: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    } catch (e) {
      throw new Error(`network error: ${redact(e instanceof Error ? e.message : "unknown", key)}`);
    }
  };
  return {
    async loadVenues(states: string[]): Promise<Venue[]> {
      const out: Venue[] = [];
      for (let from = 0; ; from += 1000) {
        const res = await call(`/venues?select=*&state=in.(${states.join(",")})&order=venue_key`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
        const text = await res.text();
        if (!res.ok) throw new Error(`read venues HTTP ${res.status}: ${redact(text.slice(0, 300), key)}`);
        const page = JSON.parse(text) as Venue[];
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    },
    async patch(venueKey: string, patch: Record<string, unknown>): Promise<void> {
      const res = await call(`/venues?venue_key=eq.${encodeURIComponent(venueKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`update ${venueKey} HTTP ${res.status}: ${redact((await res.text()).slice(0, 300), key)}`);
    },
    async insert(rows: Venue[]): Promise<void> {
      // ignore-duplicates: a rerun never overwrites a row an admin has since edited.
      const res = await call(`/venues?on_conflict=venue_key`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }))),
      });
      if (!res.ok) throw new Error(`insert HTTP ${res.status}: ${redact((await res.text()).slice(0, 300), key)}`);
    },
  };
}

// ---------------------------------------------------------------------------

type Unmatched = { reason: string; file: string; line: number; clean: Clean; note: string };

async function main() {
  const apply = flag("--apply");
  const noDb = flag("--no-db");
  const sampleN = Math.max(0, Number(arg("--sample") ?? 10) || 10);
  const dir = resolve(arg("--dir") ?? "data/research");
  const cachePath = resolve(arg("--cache") ?? join(dir, ".geocode-cache.json"));
  const outPath = resolve(arg("--out") ?? join(dir, "research-unmatched.csv"));
  const skipPath = resolve(arg("--skip") ?? join(dir, "skip.json"));
  let skipList: string[] = [];
  if (existsSync(skipPath)) {
    try {
      skipList = parseSkipList(JSON.parse(readFileSync(skipPath, "utf8")));
    } catch (e) {
      fail(`${skipPath}: ${e instanceof Error ? e.message : "could not read"}`);
    }
  }
  if (apply && noDb) fail("--apply needs the database: drop --no-db.");

  const files = arg("--file")
    ? [resolve(arg("--file")!)]
    : existsSync(dir)
      ? readdirSync(dir).filter((f) => isOutdoorFile(f) || isFacilityFile(f)).sort().map((f) => join(dir, f))
      : [];
  if (files.length === 0) fail(`No *_outdoor_soccer_fields.csv or *_soccer_facilities_*.csv files found in ${dir}.`);

  // Database target: checked before anything is read from it.
  let db: ReturnType<typeof restFns> | null = null;
  if (!noDb) {
    const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    if (!url) fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) to the dev database URL, or pass --no-db.");
    if (!key) fail("Set SUPABASE_SERVICE_ROLE_KEY in the environment, or pass --no-db.");
    const target = checkTarget(url, { allowProd: flag("--allow-prod"), expectHost: arg("--expect-host"), prodHosts: (process.env.CT_PROD_SUPABASE_HOSTS ?? "").split(",") });
    if (!target.ok) fail(target.reason);
    console.log(`${apply ? "APPLYING to" : "Dry run against"} ${target.host}`);
    db = restFns(url, key);
  } else console.log("--no-db: not reading the database; every row will count as new.");

  // Read the CSVs.
  const clean: { file: string; line: number; c: Clean }[] = [];
  let skipped = 0;
  let skippedList = 0;
  let guarded = 0;
  const skipNotes: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const st = stateFromFilename(f);
    const facility = isFacilityFile(f);
    const parsed = facility ? readFacilityCsv(text) : readResearchCsv(text);
    const { missing } = parsed;
    if (missing.length) console.log(`${basename(f)}: no ${missing.join(", ")} column (those values stay empty).`);
    const rows: (ResearchRaw | FacilityRaw)[] = parsed.rows;
    rows.forEach((r, i) => {
      if (r.name.trim() && isSkipped(r.name, skipList)) {
        skippedList++;
        skipNotes.push(`${basename(f)} line ${i + 2}: ${r.name} (skip list)`);
        return;
      }
      const c = facility ? cleanFacilityRow(r as FacilityRaw, st) : cleanRow(r as ResearchRaw, st);
      if (!c.name) {
        skipped++;
        skipNotes.push(`${basename(f)} line ${i + 2}: no name`);
        return;
      }
      clean.push({ file: basename(f), line: i + 2, c });
      if (c.priceGuarded) guarded++;
    });
    console.log(`${basename(f)}: ${rows.length} rows`);
  }

  // Geocode (cached).
  const cache = loadCache(cachePath);
  const retry = flag("--retry-failed");
  const queries = [...new Set(clean.map((x) => x.c.query).filter((q): q is string => !!q))];
  const todo = queries.filter((q) => !(q in cache.entries) || (retry && cache.entries[q] === null));
  console.log(`Geocoding: ${queries.length} addresses, ${queries.length - todo.length} cached, ${todo.length} to look up (US Census, free).`);
  let geoErrors = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const q = todo[next++]!;
        try {
          cache.entries[q] = await census(q);
        } catch (e) {
          geoErrors++;
          console.error(e instanceof Error ? e.message : "geocode error"); // not cached: it gets retried next run
        }
      }
    }),
  );
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));

  // Existing venues.
  const states = [...new Set(clean.map((x) => x.c.state).filter((s): s is string => !!s))];
  const venues: Venue[] = db && states.length ? await db.loadVenues(states) : [];
  console.log(`Loaded ${venues.length.toLocaleString()} existing venues for ${states.join(", ") || "no state"}.`);
  const index = new VenueIndex();
  const byKey = new Map<string, { before: Venue | null; after: Venue }>();
  for (const v of venues) {
    index.add(v);
    byKey.set(v.venue_key, { before: v, after: { ...v } });
  }

  // Match.
  const unmatched: Unmatched[] = [];
  const samples: { name: string; venue: string; meters: number; reason: string; changes: string[] }[] = [];
  let matchedChanged = 0;
  let matchedNoChange = 0;
  let created = 0;
  let duplicateRows = 0;
  let lowConf = 0;
  let notesOnly = 0;

  for (const { file, line, c } of clean) {
    if (c.lowConfidence) lowConf++;
    const geo = c.query ? (cache.entries[c.query] ?? null) : null;
    if (!geo) {
      unmatched.push({ reason: c.query ? "geocode_failed" : "no_address", file, line, clean: c, note: "" });
      continue;
    }
    const m = findMatch(c.name, geo.lat, geo.lon, index);
    if (m) {
      const slot = byKey.get(m.venue.venue_key)!;
      const patch = withNotes(slot.after, fillPatch(slot.after, c), c);
      if (Object.keys(patch).length === 0) {
        matchedNoChange++;
        continue;
      }
      if (Object.keys(patch).every((k) => k === "player_notes")) notesOnly++;
      if (samples.length < sampleN) samples.push({ name: c.name, venue: String(slot.after.name), meters: m.meters, reason: m.reason, changes: describeChange(slot.after, patch) });
      Object.assign(slot.after, patch);
      matchedChanged++;
      continue;
    }
    const row = newVenue(c, Number(geo.lat.toFixed(6)), Number(geo.lon.toFixed(6)), geo.matched);
    if (byKey.has(row.venue_key)) {
      duplicateRows++;
      continue;
    }
    byKey.set(row.venue_key, { before: null, after: row });
    index.add(row);
    created++;
    unmatched.push({ reason: "no_match_new_venue", file, line, clean: c, note: `${geo.matched}` });
  }

  // Report.
  const failed = unmatched.filter((u) => u.reason !== "no_match_new_venue");
  console.log("");
  console.log("=== Report ===");
  console.log(`Rows read:                       ${clean.length + skipped + skippedList}`);
  console.log(`Matched an existing venue:       ${matchedChanged + matchedNoChange}  (${matchedChanged} with new info, ${matchedNoChange} nothing new; ${notesOnly} of those only add notes)`);
  console.log(`New venues:                      ${created}${duplicateRows ? `  (+${duplicateRows} repeated rows ignored)` : ""}`);
  console.log(`Unmatched / geocode failed:      ${failed.length}`);
  console.log(`Skipped (no name):               ${skipped}`);
  console.log(`Skipped (skip list):             ${skippedList}`);
  if (guarded) console.log(`Party / package price text kept in notes only (price left unknown): ${guarded}`);
  console.log(`Low confidence (imported, flagged): ${lowConf}`);
  if (geoErrors) console.log(`Geocoder errors (will retry next run): ${geoErrors}`);
  for (const s of skipNotes.slice(0, 10)) console.log(`  skipped: ${s}`);
  if (samples.length) {
    console.log("");
    console.log(`=== ${samples.length} matches, old -> new ===`);
    for (const s of samples) {
      console.log(`${s.name}  =  ${s.venue}  (${Math.round(s.meters)} m, ${s.reason})`);
      for (const ch of s.changes) console.log(`    ${ch}`);
    }
  }

  const header = ["reason", "file", "line", "matched_address", ...RESEARCH_COLUMNS];
  // Facility rows are written in the same columns (their own columns are mapped onto them) so one review file covers both.
  const csv = [header.join(",")]
    .concat(unmatched.map((u) => [u.reason, u.file, u.line, u.note, ...RESEARCH_COLUMNS.map((k) => u.clean.raw[k])].map(csvEscape).join(",")))
    .join("\n");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, csv + "\n");
  console.log("");
  console.log(`Review file: ${outPath} (${unmatched.length} rows: geocode_failed / no_address need a better address; no_match_new_venue are the ones that will be added).`);

  if (!apply) {
    console.log("Dry run: nothing was written. Add --apply to write.");
    return;
  }
  if (!db) return;
  let patched = 0;
  const inserts: Venue[] = [];
  for (const { before, after } of byKey.values()) {
    if (!before) {
      inserts.push(after);
      continue;
    }
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(after)) if (JSON.stringify(after[k]) !== JSON.stringify(before[k]) && k !== "updated_at") diff[k] = after[k];
    if (Object.keys(diff).length === 0) continue;
    await db.patch(before.venue_key, diff);
    patched++;
  }
  for (const part of chunk(inserts, 200)) await db.insert(part);
  console.log(`Applied: ${patched} venues updated, ${inserts.length} new venues sent (rows that already existed are left alone).`);
  if (geoErrors) process.exit(1);
}

void main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
