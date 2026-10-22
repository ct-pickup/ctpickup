import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createFlagsLoader, FLAGS_OFF, flagOn, parseFlags } from "../mobile/lib/flags";

type Rpc = (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
const client = (rpc: Rpc) => ({ rpc: (n: string) => rpc(n) }) as never;
const good = (data: unknown): Rpc => async () => ({ data, error: null });

describe("app flag helper (mobile)", () => {
  it("only a literal true turns a flag on", () => {
    expect(parseFlags({ fields: true, paid_plans: false })).toEqual({ fields: true, paid_plans: false });
    for (const bad of [null, undefined, "true", 1, [], {}, { fields: "true", paid_plans: 1 }, { fields: null }, { Fields: true }]) expect(parseFlags(bad), JSON.stringify(bad)).toEqual(FLAGS_OFF);
  });
  it("admins are on for everything, everyone else follows the flag", () => {
    expect(flagOn({ fields: false, paid_plans: false }, "fields", true)).toBe(true);
    expect(flagOn({ fields: false, paid_plans: false }, "fields", false)).toBe(false);
    expect(flagOn({ fields: true, paid_plans: false }, "fields", false)).toBe(true);
    expect(flagOn({ fields: true, paid_plans: false }, "paid_plans", false)).toBe(false);
  });
  it("treats every read failure as OFF: rpc error, thrown error, timeout, missing function, no client, no user", async () => {
    const l = createFlagsLoader({ timeoutMs: 20 });
    expect(await l.load(client(async () => ({ data: null, error: { message: "function my_flags does not exist" } })), "u")).toEqual({ flags: FLAGS_OFF, ok: false });
    expect(await l.load(client(async () => { throw new Error("network"); }), "u")).toEqual({ flags: FLAGS_OFF, ok: false });
    expect((await l.load(client(() => new Promise(() => undefined)), "u")).flags).toEqual(FLAGS_OFF); // never answers
    expect((await l.load(client(good("garbage")), "u")).flags).toEqual(FLAGS_OFF);
    expect(await l.load(null, "u")).toEqual({ flags: FLAGS_OFF, ok: false });
    expect(await l.load(client(good({ fields: true })), null)).toEqual({ flags: FLAGS_OFF, ok: false });
  });
  it("returns the server's answer, caches it briefly per user, and never caches a failure", async () => {
    let t = 1000;
    const rpc = vi.fn(good({ fields: true, paid_plans: false }));
    const l = createFlagsLoader({ ttlMs: 60_000, now: () => t });
    const c = client(rpc);
    expect(await l.load(c, "u")).toEqual({ flags: { fields: true, paid_plans: false }, ok: true });
    t += 30_000;
    await l.load(c, "u");
    expect(rpc).toHaveBeenCalledTimes(1);
    await l.load(c, "someone-else");
    expect(rpc).toHaveBeenCalledTimes(2);
    t += 61_000;
    await l.load(c, "someone-else");
    expect(rpc).toHaveBeenCalledTimes(3);
    await l.load(c, "someone-else", true);
    expect(rpc).toHaveBeenCalledTimes(4);

    const l2 = createFlagsLoader({ now: () => t });
    const flaky = vi.fn<Rpc>().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ data: { fields: true }, error: null });
    expect((await l2.load(client(flaky), "u")).ok).toBe(false);
    expect((await l2.load(client(flaky), "u")).flags.fields).toBe(true); // retried at once, not stuck OFF for a minute
  });
  it("a flag turned off on the server turns off in the app on the next read", async () => {
    let on = true;
    const l = createFlagsLoader({ ttlMs: 0 });
    const c = client(async () => ({ data: { fields: on }, error: null }));
    expect((await l.load(c, "u")).flags.fields).toBe(true);
    on = false;
    expect((await l.load(c, "u")).flags.fields).toBe(false);
  });
});

describe("migration 20261024000000_app_flags.sql", () => {
  const sql = readFileSync("supabase/migrations/20261024000000_app_flags.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("creates the table as specified, with RLS, and seeds both flags OFF", () => {
    expect(code).toMatch(/create table if not exists public\.app_flags \(\s*key\s+text primary key,\s*enabled\s+boolean\s+not null default false,\s*allowlist\s+uuid\[\]\s+not null default '\{\}',\s*note\s+text,\s*updated_at timestamptz not null default now\(\)/);
    expect(code).toMatch(/alter table public\.app_flags enable row level security/);
    expect(code).toMatch(/\('fields', false,/);
    expect(code).toMatch(/\('paid_plans', false,/);
    expect(code).not.toMatch(/\('(fields|paid_plans)', true/);
  });
  it("signed-in users can select (not the allowlist); only admins and the service role can write", () => {
    expect(code).toMatch(/app_flags_select_signed_in on public\.app_flags\s+for select to authenticated using \(true\)/);
    expect(code).toMatch(/app_flags_admin_write on public\.app_flags\s+for all to authenticated\s+using \(public\.is_admin_uid\(auth\.uid\(\)\)\)\s+with check \(public\.is_admin_uid\(auth\.uid\(\)\)\)/);
    expect(code).toMatch(/grant select \(key, enabled, updated_at\) on public\.app_flags to authenticated/);
    expect(code).toMatch(/grant all on public\.app_flags to service_role/);
  });
  it("flag_on: admin, or enabled, or on the allowlist; otherwise false", () => {
    expect(code).toMatch(/when p_uid is null then false/);
    expect(code).toMatch(/when public\.is_admin_uid\(p_uid\) then true/);
    expect(code).toMatch(/f\.enabled or p_uid = any \(f\.allowlist\)/);
    expect(code).toMatch(/\), false\)/);
  });
  it("makes direct Fields writes need the flag, and has a rollback", () => {
    for (const t of ["venue_requests_insert_own", "venue_suggestions_insert_own", "venue_confirmations_insert_own", "alert_subscriptions_own", "saved_venues_own"]) expect(code, t).toMatch(new RegExp(`create policy ${t}[\\s\\S]*?flag_on\\('fields'\\)`));
    expect(sql).toMatch(/-- Rollback/);
  });
});
