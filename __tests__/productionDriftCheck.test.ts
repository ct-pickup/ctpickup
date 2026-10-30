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
/** The last migration the production drift check covers (the Fields work and the flags table). Later migrations are other projects. */
const LAST_COVERED = "20261024000000";
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
    const fields = migrations.filter((f) => ts(f) >= FIRST_FIELDS && ts(f) <= LAST_COVERED);
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

describe("Fields events table name", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const fieldsMigrations = migrations.filter((f) => ts(f) >= FIRST_FIELDS && ts(f) <= LAST_COVERED);

  it("no Fields migration touches public.events (production has an unrelated table by that name)", () => {
    for (const f of fieldsMigrations) {
      const code = read(`supabase/migrations/${f}`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(code, f).not.toMatch(/\bpublic\.events\b/);
      expect(code, f).not.toMatch(/\b(?:index|trigger|policy)\s+(?:if (?:not )?exists\s+)?"?events_/i);
    }
  });
  it("the Fields table is public.field_events, with field_events_* indexes, trigger and policies", () => {
    const sqlText = read("supabase/migrations/20261012000100_fields_requests_events_slots.sql");
    expect(sqlText).toMatch(/create table if not exists public\.field_events \(/);
    for (const n of ["field_events_starts_idx", "field_events_venue_idx", "field_events_type_idx", "field_events_touch_updated_at", "field_events_select_signed_in", "field_events_admin_write"]) expect(sqlText, n).toContain(n);
  });
  it("the app reads field_events, never events, for Fields", () => {
    expect(read("mobile/components/fields/EventsPanel.tsx")).toContain('.from("field_events")');
    expect(read("mobile/components/fields/EventsPanel.tsx")).not.toContain('.from("events")');
    expect(read("scripts/dev/fields_sample_schedule.sql")).not.toMatch(/public\.events\b/);
  });
  it("the drift check lists field_events as absent and never mentions public.events as a Fields object", () => {
    expect(sql).toContain("'no_table','field_events'");
    expect(sql).not.toMatch(/'no_table','events'/);
  });
  it("the dev rename script is idempotent, dev-only, and refuses a table without the Fields columns", () => {
    const r = read("scripts/dev/rename_fields_events.sql");
    expect(r.split("\n").slice(0, 3).join("\n")).toMatch(/DEV ONLY/);
    expect(r).toMatch(/to_regclass\('public\.field_events'\) is null/);
    expect(r).toMatch(/column_name in \('event_type', 'is_published', 'venue_key', 'starts_at'\)[\s\S]*= 4/);
    expect(r).toMatch(/alter table public\.events rename to field_events/);
    expect(r).not.toMatch(/drop table|truncate|delete from/i);
    expect(r.startsWith("--")).toBe(true);
  });
  it("no Fields object name is also created by an older migration (no collisions inside the repo)", () => {
    const names = (files: string[]) => {
      const out = new Map<string, string>();
      for (const f of files) {
        const text = read(`supabase/migrations/${f}`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
        for (const m of text.matchAll(/create (?:unique )?(?:table|index|view)(?: if not exists)?\s+(?:public\.)?"?(\w+)"?/gi)) out.set(m[1]!.toLowerCase(), f);
      }
      return out;
    };
    const older = names(migrations.filter((f) => ts(f) < FIRST_FIELDS));
    const mine = names(fieldsMigrations);
    const clash = [...mine.keys()].filter((n) => older.has(n));
    expect(clash).toEqual([]);
  });
});
