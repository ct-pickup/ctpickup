import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/20261104000000_tournament_rated_and_match_runs.sql", import.meta.url), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("tournament flags and match link migration", () => {
  it("has a rollback block at the top, before any statement", () => {
    const rollback = sql.indexOf("-- Rollback");
    const firstStatement = sql.search(/^begin;$/m);
    expect(rollback).toBeGreaterThanOrEqual(0);
    expect(rollback).toBeLessThan(firstStatement);
    const block = sql.slice(rollback, firstStatement);
    expect(block).toMatch(/drop table if exists public\.tournament_match_runs/);
    expect(block).toMatch(/drop column if exists rated/);
    expect(block).toMatch(/drop column if exists count_for_season/);
  });

  it("does nothing when the tournament tables are missing: every change sits behind a to_regclass check", () => {
    expect(code).toMatch(/to_regclass\('public\.tournaments'\) is not null/);
    expect(code).toMatch(/to_regclass\('public\.tournament_matches'\) is not null and to_regclass\('public\.pickup_runs'\) is not null/);
    // The only ALTER and CREATE statements are inside the two guarded blocks.
    const outside = code.replace(/do \$flags\$[\s\S]*?\$flags\$;/, "").replace(/do \$links\$[\s\S]*?\$links\$;/, "");
    expect(outside).not.toMatch(/\balter table\b|\bcreate table\b|\bdrop\b/i);
  });

  it("is safe to run twice", () => {
    expect(code).toMatch(/add column if not exists rated boolean not null default false/);
    expect(code).toMatch(/add column if not exists count_for_season boolean not null default false/);
    expect(code).toMatch(/create table if not exists public\.tournament_match_runs/);
  });

  it("creates the link table exactly as specified", () => {
    expect(code).toMatch(/match_id\s+uuid primary key references public\.tournament_matches \(id\) on delete cascade/);
    expect(code).toMatch(/run_id\s+uuid not null unique references public\.pickup_runs \(id\) on delete cascade/);
    expect(code).toMatch(/created_at\s+timestamptz not null default now\(\)/);
  });

  it("is service role only: row level security on and no policies", () => {
    expect(code).toMatch(/alter table public\.tournament_match_runs enable row level security/);
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/revoke all on table public\.tournament_match_runs from anon, authenticated/);
  });

  it("touches no other tournament table and none of the rating, points or season objects", () => {
    const alters = [...code.matchAll(/alter table ([\w.]+)/gi)].map((m) => m[1]);
    expect(new Set(alters)).toEqual(new Set(["public.tournaments", "public.tournament_match_runs"]));
    expect(code).not.toMatch(/player_ratings|rating_events|rating_config|settle_session|points_events|season_prize|season_purchases|app_flags/i);
  });

  it("has no em dashes and no tier or wave wording", () => {
    expect(sql).not.toMatch(/—/);
    expect(sql).not.toMatch(/\btier\b|\bwave\b/i);
  });
});
