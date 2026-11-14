import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLAG_KEYS } from "../../lib/flags";
import { FLAGS_OFF, parseFlags } from "../../mobile/lib/flags";

const sql = readFileSync(new URL("../../supabase/migrations/20261105000000_require_ratings_flag.sql", import.meta.url), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("require_ratings flag migration", () => {
  it("inserts one row, off, and is safe to run twice", () => {
    expect(code).toMatch(/insert into public\.app_flags \(key, enabled, note\) values/);
    expect(code).toMatch(/\('require_ratings', false,/);
    expect(code).toMatch(/on conflict \(key\) do nothing/);
    expect([...code.matchAll(/\('([a-z_]+)', (true|false),/g)].map((m) => [m[1], m[2]])).toEqual([["require_ratings", "false"]]);
  });

  it("touches nothing else and has a rollback", () => {
    expect(code).not.toMatch(/\balter\b|\bdrop\b|\bcreate\b|\bdelete\b|\bupdate\b/i);
    expect(sql).toMatch(/-- Rollback[\s\S]*delete from public\.app_flags where key = 'require_ratings'/);
    expect(code).toMatch(/^begin;$/m);
    expect(code).toMatch(/^commit;$/m);
  });

  it("has no em dash and no tier or wave wording", () => {
    expect(sql).not.toMatch(/—/);
    expect(sql).not.toMatch(/\btier\b|\bwave\b/i);
  });
});

describe("the flag is known to the server and the app", () => {
  it("is in the server's list and the app's defaults, off", () => {
    expect(FLAG_KEYS).toContain("require_ratings");
    expect(FLAGS_OFF.require_ratings).toBe(false);
    expect(parseFlags({ require_ratings: true }).require_ratings).toBe(true);
    expect(parseFlags({ require_ratings: "true" }).require_ratings).toBe(false);
    expect(parseFlags({}).require_ratings).toBe(false);
  });
});
