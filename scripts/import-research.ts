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
 *   (Rows held back as possible duplicates that are within 400 m of an existing venue and share a name word with it, or its town and venue
 *    type, are attached to that venue instead: booking, website and notes only, never price, permit, surface or lit.)
 *   --include-possible-duplicates   insert new venues even when an existing venue is within 300 m of them (or, for a school, a venue
 *                        with the same school name within 800 m). By default those are held back and listed in the review CSV.
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
  isFacilityFile,
  isOutdoorFile,
  isSkipped,
  parseSkipList,
  planImport,
  readFacilityCsv,
  readResearchCsv,
  RESEARCH_COLUMNS,
  stateFromFilename,
  type Clean,
  type FacilityRaw,
  type Item,
  type Near,
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
  const items: Item[] = clean.map((x) => ({ file: x.file, line: x.line, c: x.c, geo: x.c.query ? (cache.entries[x.c.query] ?? null) : null }));
  const plan = planImport(items, venues, { includeDuplicates: flag("--include-possible-duplicates") });
  const lowConf = clean.filter((x) => x.c.lowConfidence).length;

  const changed = plan.updates.filter((u) => Object.keys(u.patch).length > 0);
  const matchedRows = plan.updates.reduce((n, u) => n + u.items.length, 0);
  const notesOnly = changed.filter((u) => Object.keys(u.patch).every((k) => k === "player_notes")).length;
  const campus = plan.updates.filter((u) => u.disagreements.length > 0).length;
  const failedRows = plan.noGeo;

  // Report.
  console.log("");
  console.log("=== Report ===");
  console.log(`Rows read:                       ${clean.length + skipped + skippedList}`);
  console.log(`Matched an existing venue:       ${matchedRows} rows -> ${plan.updates.length} venues  (${changed.length} with new info, ${plan.updates.length - changed.length} nothing new; ${notesOnly} only add notes)`);
  if (campus) console.log(`  rows disagreed on a value (left empty, "multiple fields on this campus" noted): ${campus} venues`);
  const byRule = (r: string) => plan.updates.reduce((n, u) => n + u.matches.filter((m) => m.reason === r).length, 0);
  console.log(`  by rule: similar name nearby ${byRule("near + similar name")}, same venue name within 1.5 km ${byRule("same venue name")}, very near (40 m) ${byRule("very near")}`);
  console.log(`Attached to existing (booking, website, notes only): ${plan.attached.length} rows -> ${new Set(plan.attached.map((a) => a.near.venue.venue_key)).size} venues`);
  console.log(`New venues:                      ${plan.inserts.length}${plan.repeats.length ? `  (+${plan.repeats.length} repeated rows ignored)` : ""}`);
  console.log(`Possible duplicates held back:   ${plan.duplicates.length}${flag("--include-possible-duplicates") ? "  (--include-possible-duplicates: inserted anyway)" : ""}`);
  console.log(`Unmatched / geocode failed:      ${failedRows.length}`);
  console.log(`Skipped (no name):               ${skipped}`);
  console.log(`Skipped (skip list):             ${skippedList}`);
  if (guarded) console.log(`Price text kept in notes only (party / package / group tier; price left unknown): ${guarded}`);
  console.log(`Low confidence (imported, flagged): ${lowConf}`);
  if (geoErrors) console.log(`Geocoder errors (will retry next run): ${geoErrors}`);
  for (const s of skipNotes.slice(0, 10)) console.log(`  skipped: ${s}`);

  if (changed.length) {
    console.log("");
    console.log(`=== ${Math.min(sampleN, changed.length)} matches, old -> new ===`);
    for (const u of changed.slice(0, sampleN)) {
      console.log(`${u.items.map((i) => i.c.name).join(" + ")}  =  ${u.venue.name}  (${u.matches.map((m) => `${Math.round(m.meters)} m, ${m.reason}`).join("; ")})`);
      for (const ch of describeChange(u.venue, u.patch)) console.log(`    ${ch}`);
      if (u.disagreements.length) console.log(`    (rows disagree on ${u.disagreements.join(", ")}: left empty)`);
    }
  }
  console.log("");
  console.log(`=== Sample of ${Math.min(10, plan.inserts.length)} new venues ===`);
  for (const ins of plan.inserts.slice(0, 10)) {
    const n = ins.nearest;
    console.log(`${ins.venue.name}  (${ins.venue.address ?? "no address"})  nearest existing: ${n ? `${n.venue.name} [${n.venue.venue_key}], ${Math.round(n.meters)} m` : "none within 2 km"}${ins.flaggedDuplicate ? "  <- possible duplicate, inserted anyway" : ""}`);
  }
  if (plan.inserts.length === 0) console.log("(none)");
  console.log(`Possible duplicates held back: ${plan.duplicates.length}${plan.duplicates.length ? " (see the review file)" : ""}`);
  if (plan.attached.length) {
    console.log("");
    console.log(`=== Attached to existing (first 25) ===`);
    for (const a of plan.attached.slice(0, 25)) console.log(`  ${a.item.c.name}  ->  ${a.near.venue.name} [${a.near.venue.venue_key}], ${Math.round(a.near.meters)} m (${a.why})`);
  }
  for (const d of plan.duplicates.slice(0, 10)) console.log(`  ${d.item.c.name}  ~  ${d.near.venue.name} [${d.near.venue.venue_key}], ${Math.round(d.near.meters)} m (${d.why})`);

  type Out = { reason: string; item: Item; nearest?: Near | null; note: string };
  const out: Out[] = [
    ...failedRows.map((item) => ({ reason: item.c.query ? "geocode_failed" : "no_address", item, note: "" })),
    ...plan.attached.map((a) => ({ reason: "attached_to_existing", item: a.item, nearest: a.near, note: a.why })),
    ...plan.duplicates.map((d) => ({ reason: "possible_duplicate", item: d.item, nearest: d.near, note: d.why })),
    ...plan.repeats.map((r) => ({ reason: "repeat_of_new_row", item: r.item, note: r.of })),
    ...plan.inserts.map((i) => ({ reason: i.flaggedDuplicate ? "new_venue_flagged_duplicate" : "no_match_new_venue", item: i.item, nearest: i.nearest, note: i.item.geo?.matched ?? "" })),
  ];
  const header = ["reason", "file", "line", "matched_address_or_note", "nearest_existing_name", "nearest_existing_meters", "nearest_existing_id", ...RESEARCH_COLUMNS];
  // Facility rows are written in the same columns (their own columns are mapped onto them) so one review file covers both.
  const csv = [header.join(",")]
    .concat(
      out.map((u) =>
        [u.reason, u.item.file, u.item.line, u.note, u.nearest?.venue.name ?? "", u.nearest ? Math.round(u.nearest.meters) : "", u.nearest?.venue.venue_key ?? "", ...RESEARCH_COLUMNS.map((k) => u.item.c.raw[k])].map(csvEscape).join(","),
      ),
    )
    .join("\n");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, csv + "\n");
  console.log("");
  console.log(`Review file: ${outPath} (${out.length} rows). geocode_failed / no_address need a better address; possible_duplicate were held back (nearest existing venue listed); attached_to_existing were merged into that venue (booking, website, notes only); no_match_new_venue will be added.`);

  if (!apply) {
    console.log("Dry run: nothing was written. Add --apply to write.");
    return;
  }
  if (!db) return;
  let patched = 0;
  for (const u of changed) {
    await db.patch(u.venue.venue_key, u.patch);
    patched++;
  }
  const inserts = plan.inserts.map((i) => i.venue);
  for (const part of chunk(inserts, 200)) await db.insert(part);
  console.log(`Applied: ${patched} venues updated, ${inserts.length} new venues sent (rows that already existed are left alone).`);
  if (geoErrors) process.exit(1);
}

void main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
