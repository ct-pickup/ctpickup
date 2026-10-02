import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `pickup_runs.time_tbd` (20261004000000_pickup_runs_time_tbd.sql). Read in its own query so screens keep
 * working before the migration runs: a missing column reads as false for every run.
 * Keep mobile/lib/pickup/runTimeTbd.ts identical (scripts/sync-mobile-lib-pickup.mjs).
 */
type DbError = { code?: string; message?: string } | null | undefined;

export function isMissingTimeTbdColumn(err: DbError): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /could not find|does not exist|schema cache/i.test(msg)) && /time_tbd/i.test(msg);
}

/** Ids of the given runs whose time is TBD. Empty when the column is missing or the read fails. */
export async function fetchRunTimeTbdIds(supabase: SupabaseClient, runIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  const out = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from("pickup_runs").select("id,time_tbd").in("id", ids.slice(i, i + CHUNK));
    if (error) {
      if (!isMissingTimeTbdColumn(error)) console.warn("[runTimeTbd] time_tbd unavailable:", error.message);
      return new Set();
    }
    for (const row of (data ?? []) as Array<{ id: string; time_tbd: boolean | null }>) {
      if (row.time_tbd === true) out.add(row.id);
    }
  }
  return out;
}

/** The rows with `time_tbd` set from the column (false when missing). */
export async function withRunTimeTbd<T extends { id: string }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<Array<T & { time_tbd: boolean }>> {
  const tbd = await fetchRunTimeTbdIds(supabase, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, time_tbd: tbd.has(r.id) }));
}

/**
 * Runs an insert or update that sets `time_tbd`, retrying without it when the column is missing.
 * `write(true)` should include `time_tbd`; `write(false)` the same write without it.
 */
export async function writeWithOptionalTimeTbd<R extends { error: DbError }>(write: (withTimeTbd: boolean) => PromiseLike<R>): Promise<R> {
  const first = await write(true);
  if (!isMissingTimeTbdColumn(first.error)) return first;
  console.warn("[runTimeTbd] pickup_runs.time_tbd missing; saved without it. Run 20261004000000_pickup_runs_time_tbd.sql.");
  return write(false);
}
