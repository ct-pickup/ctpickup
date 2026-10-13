/**
 * Imports the Connecticut venue data run into a Supabase database through public.upsert_schools and
 * public.upsert_venues (migration 20261013000000 keeps verified, manual and hand-checked price / booking / permit data).
 *
 * Reads data/ct/ct_schools.json and data/ct/ct_venues.json, converts verified 0/1 to booleans, validates every row,
 * then sends batches of 500. Prints inserted / updated / protected counts. Writes nothing but those RPC calls.
 *
 *   SUPABASE_URL=https://<dev-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types scripts/import-ct-venues.ts --expect-host <dev-ref>.supabase.co
 *
 * Options:
 *   --dry-run            validate and count only; no key needed and no network
 *   --expect-host HOST   required for any remote database: repeat the host to confirm it is the one you mean
 *   --allow-prod         lets the run proceed when the URL looks like production (still needs --expect-host)
 *   --venues PATH / --schools PATH   override the default file locations
 *
 * The service role key is read only from SUPABASE_SERVICE_ROLE_KEY and is never printed or logged.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkTarget, chunk, extractRows, normalizeSchool, normalizeVenue, redact, type NormalizeResult } from "./lib/ctImport.ts";

const BATCH = 500;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const flag = (name: string): boolean => process.argv.includes(name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function load(path: string, normalize: (r: unknown) => NormalizeResult, label: string) {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (e) {
    fail(`Could not read ${label} from ${path}: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  let raw: unknown[];
  try {
    raw = extractRows(json);
  } catch (e) {
    fail(`${path}: ${e instanceof Error ? e.message : "bad file"}`);
  }
  const rows: Record<string, unknown>[] = [];
  const bad: string[] = [];
  const dropped = new Set<string>();
  raw.forEach((r, i) => {
    const res = normalize(r);
    res.droppedKeys.forEach((k) => dropped.add(k));
    if (res.row) rows.push(res.row);
    else bad.push(`  row ${i}${(r as { venue_key?: string; school_key?: string })?.venue_key ? ` (${(r as { venue_key?: string }).venue_key})` : ""}: ${res.problems.join("; ")}`);
  });
  if (bad.length) {
    console.error(`${label}: ${bad.length} of ${raw.length} rows are invalid. Nothing was sent. First problems:`);
    console.error(bad.slice(0, 10).join("\n"));
    process.exit(1);
  }
  const keyed = new Set(rows.map((r) => String(r.venue_key ?? r.school_key)));
  console.log(`${label}: ${rows.length} rows (${rows.length - keyed.size} duplicate keys will collapse)${dropped.size ? `; ignoring unknown fields: ${[...dropped].join(", ")}` : ""}`);
  return rows;
}

type Counts = { inserted: number; updated: number; protected?: number };

async function rpc(url: string, key: string, fn: string, rows: Record<string, unknown>[]): Promise<Counts> {
  const total: Counts = { inserted: 0, updated: 0, protected: 0 };
  for (const part of chunk(rows, BATCH)) {
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_rows: part }),
      });
    } catch (e) {
      fail(`${fn}: network error: ${redact(e instanceof Error ? e.message : "unknown", key)}`);
    }
    const text = await res.text();
    if (!res.ok) fail(`${fn} failed (HTTP ${res.status}): ${redact(text.slice(0, 400), key)}. Earlier batches in this run were already applied; re-running is safe.`);
    const out = JSON.parse(text) as Counts[] | Counts;
    const c = Array.isArray(out) ? out[0] : out;
    total.inserted += Number(c?.inserted ?? 0);
    total.updated += Number(c?.updated ?? 0);
    total.protected = (total.protected ?? 0) + Number(c?.protected ?? 0);
  }
  return total;
}

async function main() {
  const dryRun = flag("--dry-run");
  const schools = load(arg("--schools") ?? "data/ct/ct_schools.json", normalizeSchool, "schools");
  const venues = load(arg("--venues") ?? "data/ct/ct_venues.json", normalizeVenue, "venues");
  const verified = venues.filter((v) => v.verified === true).length;
  console.log(`venues marked verified in the file: ${verified} (they keep their price, booking and permit data if the database already has them verified)`);

  if (dryRun) {
    console.log("Dry run: nothing was sent.");
    return;
  }

  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url) fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) to the dev database URL.");
  if (!key) fail("Set SUPABASE_SERVICE_ROLE_KEY in the environment.");

  const target = checkTarget(url, {
    allowProd: flag("--allow-prod"),
    expectHost: arg("--expect-host"),
    prodHosts: (process.env.CT_PROD_SUPABASE_HOSTS ?? "").split(","),
  });
  if (!target.ok) fail(target.reason);
  console.log(`Importing into ${target.host}`);

  const s = await rpc(url, key, "upsert_schools", schools);
  console.log(`schools: inserted ${s.inserted}, updated ${s.updated}`);
  const v = await rpc(url, key, "upsert_venues", venues);
  console.log(`venues:  inserted ${v.inserted}, updated ${v.updated}, protected ${v.protected ?? 0}`);
  console.log("Done.");
}

void main();
