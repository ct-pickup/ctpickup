import { spawnSync } from "node:child_process";

/**
 * Runs SQL against a real Postgres. Off unless TEST_DATABASE_URL is set, so `npx vitest run` stays offline by default.
 *
 *   TEST_DATABASE_URL="postgresql://..." npx vitest run __tests__/sql
 *
 * Point it at the DEV database (stubs for pickup_runs and pickup_run_rsvps are enough) or a local scratch one, never production.
 * Every script runs inside BEGIN ... ROLLBACK, so nothing a test inserts is kept. Output is `psql -At -F '|'`: one line per row.
 */

export const TEST_DB = (process.env.TEST_DATABASE_URL ?? "").trim();
const psqlOk = spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
export const SQL_TESTS_ENABLED = TEST_DB !== "" && psqlOk;

if (TEST_DB && /txsagoaqnohdnykweslc/.test(TEST_DB)) throw new Error("TEST_DATABASE_URL points at production. Refusing to run.");

type Result = { out: string[]; err: string; ok: boolean };

function run(script: string): Result {
  const r = spawnSync("psql", [TEST_DB, "-X", "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: `begin;\n${script}\nrollback;\n`, encoding: "utf8" });
  return { out: (r.stdout ?? "").split("\n").filter((l) => l !== ""), err: r.stderr ?? "", ok: r.status === 0 };
}

/** Lines the script's SELECTs printed. Throws with psql's message if a statement failed. */
export function sql(script: string): string[] {
  const r = run(script);
  if (!r.ok) throw new Error(r.err.trim() || "psql failed");
  return r.out;
}

/** The error message psql printed, or null if the script ran clean. For checking that a constraint or policy refuses something. */
export function sqlError(script: string): string | null {
  const r = run(script);
  return r.ok ? null : r.err.trim();
}

/** A fresh random uuid literal for fixtures. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
