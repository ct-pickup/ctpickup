import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STUB = "scripts/dev/dev_pickup_runs_stub.sql";
const sql = read(STUB);

/** Columns the stub defines on pickup_runs: the create table body plus every `add column if not exists`. */
function stubColumns(): Set<string> {
  const cols = new Set<string>();
  const body = /create table if not exists public\.pickup_runs \(([\s\S]*?)\n\);/.exec(sql)![1]!;
  for (const line of body.split("\n")) {
    const m = /^\s{2}(\w+)\s+[a-z]/.exec(line);
    if (m) cols.add(m[1]!);
  }
  for (const m of sql.matchAll(/alter table public\.pickup_runs add column if not exists (\w+)/g)) cols.add(m[1]!);
  if (/add column is_completed boolean generated/.test(sql)) cols.add("is_completed");
  return cols;
}

describe("dev pickup_runs stub", () => {
  it("is a dev script, not a migration, and never ends up in supabase/migrations", () => {
    expect(existsSync(new URL(STUB, root))).toBe(true);
    const migrations = readdirSync(new URL("supabase/migrations/", root));
    expect(migrations.some((f) => /dev_pickup_runs_stub/i.test(f))).toBe(false);
    for (const f of migrations) expect(readFileSync(new URL(`supabase/migrations/${f}`, root), "utf8")).not.toMatch(/DEV ONLY\.\s+NEVER RUN THIS ON PRODUCTION/);
  });

  it("starts with the loud warning", () => {
    const head = sql.split("\n").slice(0, 3).join("\n");
    expect(head).toMatch(/DEV ONLY\.\s+NEVER RUN THIS ON PRODUCTION/);
    expect(sql).toMatch(/production already has the real pickup_runs table/i);
    expect(sql).toMatch(/Run it more than once safely/);
  });

  it("is idempotent: every create and add is guarded, every policy is dropped first", () => {
    for (const m of sql.matchAll(/^create (table|index)\b(?! if not exists)/gim)) throw new Error(`unguarded: ${m[0]}`);
    // The one plain "add column" (is_completed, a generated column) sits inside a DO block guarded by an information_schema check.
    for (const m of sql.matchAll(/alter table public\.\w+ add column (?!if not exists|is_completed)/g)) throw new Error(`unguarded add column near ${m.index}`);
    expect(sql).toMatch(/if not exists \(select 1 from information_schema\.columns[^)]*column_name = 'is_completed'\)\s+then\s+alter table public\.pickup_runs add column is_completed/);
    const policies = [...sql.matchAll(/^create policy (\w+)/gm)].map((m) => m[1]!);
    expect(policies.length).toBeGreaterThanOrEqual(5);
    for (const p of policies) expect(sql).toMatch(new RegExp(`drop policy if exists ${p} on`));
  });

  it("has a primary key, a host reference to profiles, timestamps and RLS", () => {
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/);
    expect(sql).toMatch(/created_by\s+uuid references public\.profiles \(id\)/);
    expect(sql).toMatch(/created_at\s+timestamptz not null default now\(\)/);
    expect(sql).toMatch(/alter table public\.pickup_runs enable row level security/);
    expect(sql).toMatch(/alter table public\.pickup_run_rsvps enable row level security/);
  });

  it("has every column the create route inserts", () => {
    const route = read("app/api/sessions/create/route.ts");
    const insert = /\.from\("pickup_runs"\)\s*\.insert\(\{([\s\S]*?)\n\s{4}\}\)/.exec(route)![1]!;
    const keys = [...insert.matchAll(/^\s{6}(\w+)[,:]/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(15);
    const have = stubColumns();
    for (const k of keys) expect(have.has(k), `create route inserts ${k}`).toBe(true);
  });

  it("has every column the game page reads", () => {
    const page = read("mobile/app/session/[id].tsx");
    const select = /\.from\("pickup_runs"\)\s*\.select\("([^"]+)"\)/.exec(page)![1]!;
    const have = stubColumns();
    for (const k of select.split(",")) expect(have.has(k.trim()), `game page reads ${k}`).toBe(true);
  });

  it("has every column the migrations add to pickup_runs, except the two the games_at_fields migration adds", () => {
    const have = stubColumns();
    const expected = [
      "is_current", "outreach_started_at", "auto_managed", "auto_cp_24h_at", "auto_cp_12h_at", "auto_cp_6h_at", "auto_cp_1h_at", "service_region", "next_wave_at",
      "current_wave", "locked_at", "admin_fee_cents", "wave_state", "venue_zip_code", "latitude", "longitude", "level", "spots_taken", "is_completed",
      "voting_notif_sent", "field_photo_url", "time_tbd", "min_star",
    ];
    for (const c of expected) expect(have.has(c), c).toBe(true);
    // Left to 20261023000000_games_at_fields.sql, so that migration is really exercised on dev.
    expect(have.has("venue_key")).toBe(false);
    expect(have.has("venue_request_id")).toBe(false);
    expect(readFileSync(new URL("supabase/migrations/20261023000000_games_at_fields.sql", root), "utf8")).toMatch(/pickup_runs add column if not exists venue_key/);
  });

  it("stubs only what creating and opening a game needs", () => {
    const tables = [...sql.matchAll(/^create table if not exists public\.(\w+)/gm)].map((m) => m[1]);
    expect(tables).toEqual(["pickup_runs", "pickup_run_rsvps"]);
  });
});
