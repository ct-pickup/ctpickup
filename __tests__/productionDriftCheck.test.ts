import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("scripts/dev/production_drift_check.sql", "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
/** The statement with string literals blanked, so only real SQL words are inspected. */
const bare = code.replace(/'(?:[^']|'')*'/g, "''");
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const CUTOFF = "20260523120000";
const FIRST_FIELDS = "20261012000000";
const ts = (f: string) => f.split("_")[0]!;

describe("scripts/dev/production_drift_check.sql", () => {
  it("opens with a loud read-only warning", () => {
    expect(sql.split("\n").slice(0, 4).join("\n")).toMatch(/READ-ONLY/);
  });
  it("is one SELECT statement: no DDL, no writes, no side-effect functions", () => {
    expect(code.trim().startsWith("with expected")).toBe(true);
    expect(bare.trim().endsWith(";")).toBe(true);
    expect(bare.trim().slice(0, -1)).not.toContain(";");
    expect(bare).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment\s+on|copy|vacuum|reindex|call|do|set|reset|lock|notify|listen|refresh|execute)\b\s/i);
    expect(bare).not.toMatch(/\b(pg_notify|set_config|nextval|setval|pg_terminate_backend|dblink|lo_import|lo_export)\s*\(/i);
  });
  it("covers every migration after 20260523120000 and before the Fields migrations (section A)", () => {
    const wanted = migrations.filter((f) => ts(f) > CUTOFF && ts(f) < FIRST_FIELDS);
    expect(wanted.length).toBeGreaterThan(30);
    for (const f of wanted) expect(sql, f).toContain(`('A','${f}'`);
  });
  it("covers every Fields migration (20261012 onward) as absent (section B)", () => {
    const fields = migrations.filter((f) => ts(f) >= FIRST_FIELDS);
    expect(fields.length).toBeGreaterThanOrEqual(15);
    for (const f of fields) expect(sql, f).toContain(`('B','${f}'`);
  });
  it("only lists objects that appear in the migration they are attributed to", () => {
    const rowRe = /\('([ABC])','([^']+)','([^']+)',(NULL|'(?:[^']|'')*'),(NULL|'(?:[^']|'')*'),(NULL|'(?:[^']|'')*'),(true|false)\)/g;
    const unq = (v: string) => (v === "NULL" ? null : v.slice(1, -1).replace(/''/g, "'"));
    let n = 0;
    for (const m of sql.matchAll(rowRe)) {
      const [, sec, mig, kind, a, b] = m;
      if (sec === "C") continue;
      n++;
      const text = readFileSync(`supabase/migrations/${mig}`, "utf8").toLowerCase();
      const k = kind!.replace(/^no_/, "");
      const needle = ["column", "notnull", "nullable", "policy", "constraint", "enum", "trigger"].includes(k) ? unq(b!) : unq(a!);
      expect(needle, `${mig} ${kind}`).toBeTruthy();
      expect(text, `${mig}: ${kind} ${needle}`).toContain(needle!.toLowerCase());
    }
    expect(n).toBeGreaterThan(250);
  });
});
