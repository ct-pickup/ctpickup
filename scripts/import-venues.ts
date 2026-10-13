/**
 * Imports the nationwide venue snapshot (SQLite) into a Supabase database, state by state, through public.upsert_schools and
 * public.upsert_venues. Replaces import-ct-venues.ts for everything but a quick JSON load. Repeatable by state.
 *
 *   # check first: reads the snapshot only, no key, no network
 *   node --experimental-strip-types scripts/import-venues.ts --db ~/ctpickup-data-backup/venues_snapshot_oct13.db --states CT --dry-run
 *
 *   # import one state
 *   SUPABASE_URL=https://<dev-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types scripts/import-venues.ts --db ~/ctpickup-data-backup/venues_snapshot_oct13.db \
 *     --states CT --expect-host <dev-ref>.supabase.co
 *
 * Options:
 *   --db PATH            the SQLite snapshot (tables venues and schools)
 *   --states LIST|all    CT,NY,... or all. Required.
 *   --dry-run            read and validate, print per-state counts, send nothing (no key needed)
 *   --expect-host HOST   required for any remote database: repeat the host to confirm it is the one you mean
 *   --allow-prod         lets the run proceed when the URL looks like production (still needs --expect-host)
 *   --batch N            rows per request (default 500)
 *   --only venues|schools   import just one table
 *   --include-unnamed    import rows with no name as "Unnamed field" / "Unnamed school" (default: skip and count them)
 *   --skip-invalid       send a state's valid rows even if it has invalid ones (default: skip that whole state and report it)
 *
 * Safe to re-run. upsert_venues keeps price, booking and permit data (and verified) on verified or hand-entered rows.
 * The service role key is read only from SUPABASE_SERVICE_ROLE_KEY and is never printed or logged.
 */
import { resolve } from "node:path";
import { homedir } from "node:os";

import { checkTarget, redact } from "./lib/ctImport.ts";
import { listStates, openSqlite, parseStates, runImport, totals, type Counts, type RpcFn, type Row } from "./lib/venueImport.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const flag = (name: string): boolean => process.argv.includes(name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function makeRpc(url: string, key: string): RpcFn {
  return async (fn, rows: Row[]): Promise<Counts> => {
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_rows: rows }),
      });
    } catch (e) {
      throw new Error(`network error: ${redact(e instanceof Error ? e.message : "unknown", key)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn} HTTP ${res.status}: ${redact(text.slice(0, 300), key)}`);
    const out = JSON.parse(text) as Counts[] | Counts;
    const c = Array.isArray(out) ? out[0] : out;
    return { inserted: Number(c?.inserted ?? 0), updated: Number(c?.updated ?? 0), protected: Number(c?.protected ?? 0) };
  };
}

async function main() {
  const dbPath = arg("--db");
  if (!dbPath) fail("Pass --db PATH to the SQLite snapshot.");
  const dryRun = flag("--dry-run");
  const only = (arg("--only") ?? "both") as "venues" | "schools" | "both";
  if (!["venues", "schools", "both"].includes(only)) fail("--only must be venues or schools.");
  const batch = Math.max(1, Math.min(1000, Number(arg("--batch") ?? 500) || 500));

  const src = await openSqlite(expandHome(dbPath));
  console.log(`Reading ${expandHome(dbPath)} with ${src.kind}`);
  const available = listStates(src);
  const picked = parseStates(arg("--states"), available);
  if (picked.error) fail(picked.error);
  if (picked.unknown.length) console.log(`Not in the snapshot (skipped): ${picked.unknown.join(", ")}`);
  if (picked.states.length === 0) fail("No states to import.");
  console.log(`States: ${picked.states.join(", ")}`);

  let rpc: RpcFn = async () => {
    throw new Error("dry run: nothing is sent");
  };
  if (!dryRun) {
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
    rpc = makeRpc(url, key);
  }

  const started = Date.now();
  const outcomes = await runImport({
    src,
    states: picked.states,
    rpc,
    batch,
    dryRun,
    skipInvalid: flag("--skip-invalid"),
    only,
    includeUnnamed: flag("--include-unnamed"),
    log: (line) => console.log(line),
  });
  src.close();

  const t = totals(outcomes);
  console.log("");
  console.log("state  venues(send/unnamed)  schools(send/unnamed)  result");
  for (const o of outcomes) {
    const result = o.failed ? `FAILED: ${o.failed}` : o.venues.invalid.length + o.schools.invalid.length > 0 && !o.sent && !dryRun ? "skipped (invalid rows)" : dryRun ? "dry run" : `+${o.venues.inserted}/~${o.venues.updated}/protected ${o.venues.protected}`;
    console.log(`${o.state.padEnd(5)}  ${`${o.venues.toSend}/${o.venues.unnamed}`.padEnd(20)}  ${`${o.schools.toSend}/${o.schools.unnamed}`.padEnd(21)}  ${result}`);
  }
  console.log("");
  console.log(`Total: ${t.venuesSent.toLocaleString()} venues and ${t.schoolsSent.toLocaleString()} schools ${dryRun ? "would be sent" : "sent"}; skipped ${t.venuesUnnamed.toLocaleString()} unnamed venues and ${t.schoolsUnnamed.toLocaleString()} unnamed schools.`);
  if (!dryRun) console.log(`Venues: ${t.venuesInserted.toLocaleString()} new, ${t.venuesUpdated.toLocaleString()} updated, ${t.venuesProtected.toLocaleString()} protected. Schools: ${t.schoolsInserted.toLocaleString()} new, ${t.schoolsUpdated.toLocaleString()} updated.`);
  console.log(`Took ${Math.round((Date.now() - started) / 1000)}s.`);
  if (t.failed > 0 || t.invalidStates > 0) process.exit(1);
}

void main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
