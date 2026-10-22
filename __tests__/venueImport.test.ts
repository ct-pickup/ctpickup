import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listStates, openSqlite, parseSqliteJson, parseStates, readStateRows, runImport, totals, type Counts, type Row, type RpcFn, type SqliteSource } from "../scripts/lib/venueImport";

let dir = "";
let dbPath = "";
let src: SqliteSource;

function venue(key: string, state: string, over: Record<string, unknown> = {}): Row {
  return { venue_key: key, state, name: `Field ${key}`, lat: 41.1, lon: -73.2, venue_type: "park", price_status: "unknown", price_source: "unknown", booking_method: "unknown", permit_required: "unknown", verified: 0, setting: "outdoor", ...over };
}
function school(key: string, state: string, over: Record<string, unknown> = {}): Row {
  return { school_key: key, state, name: `School ${key}`, kind: "public", has_field_mapped: 0, ...over };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "venues-"));
  dbPath = join(dir, "snap.db");
  const name = "node:sqlite";
  const { DatabaseSync } = (await import(name)) as { DatabaseSync: new (p: string) => { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): void }; close(): void } };
  const db = new DatabaseSync(dbPath);
  db.exec(`create table venues (venue_key text primary key, state text, name text, lat real, lon real, venue_type text, price_status text, price_source text, booking_method text, permit_required text, verified integer, setting text);
           create table schools (school_key text primary key, state text, name text, kind text, has_field_mapped integer);`);
  const insV = db.prepare("insert into venues values (?,?,?,?,?,?,?,?,?,?,?,?)");
  const insS = db.prepare("insert into schools values (?,?,?,?,?)");
  const rows: Row[] = [];
  for (let i = 0; i < 1100; i++) rows.push(venue(`CT-${String(i).padStart(4, "0")}`, "CT", i % 10 === 0 ? { name: "" } : i === 5 ? { setting: "indoor" } : {}));
  rows.push(venue("NY-1", "NY", { setting: "both" }), venue("NY-2", "NY", { setting: "covered" }), venue("WY-1", "WY", { verified: 1 }));
  for (const r of rows) insV.run(r.venue_key, r.state, r.name, r.lat, r.lon, r.venue_type, r.price_status, r.price_source, r.booking_method, r.permit_required, r.verified, r.setting);
  for (let i = 0; i < 700; i++) { const s = school(`CT-S${i}`, "CT", i % 100 === 0 ? { name: "" } : {}); insS.run(s.school_key, s.state, s.name, s.kind, s.has_field_mapped); }
  insS.run("NY-S1", "NY", "NY school", "public", 1);
  db.close();
  src = await openSqlite(dbPath);
});
afterAll(() => {
  src?.close();
  rmSync(dir, { recursive: true, force: true });
});

function recorder() {
  const calls: { fn: string; n: number }[] = [];
  const rpc: RpcFn = async (fn, rows) => {
    calls.push({ fn, n: rows.length });
    const c: Counts = { inserted: rows.length, updated: 0, protected: fn === "upsert_venues" ? 1 : 0 };
    return c;
  };
  return { calls, rpc };
}
const base = { batch: 500, dryRun: false, skipInvalid: false, only: "both" as const, includeUnnamed: false, log: () => {} };

describe("reading the snapshot", () => {
  it("lists states and reads one state at a time", () => {
    expect(listStates(src)).toEqual(["CT", "NY", "WY"]);
    expect(readStateRows(src, "venues", "NY")).toHaveLength(2);
    expect(readStateRows(src, "schools", "CT")).toHaveLength(700);
    expect(() => readStateRows(src, "venues", "CT'; drop table venues;--")).toThrow();
  });
  it("parses sqlite3 -json output, including no output for zero rows", () => {
    expect(parseSqliteJson("")).toEqual([]);
    expect(parseSqliteJson('[{"a":1},\n{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(() => parseSqliteJson('{"a":1}')).toThrow();
  });
  it("picks states", () => {
    const avail = ["CT", "NY", "WY"];
    expect(parseStates("ct, ny", avail)).toEqual({ states: ["CT", "NY"], unknown: [] });
    expect(parseStates("all", avail).states).toEqual(avail);
    expect(parseStates("CT,WI", avail)).toEqual({ states: ["CT"], unknown: ["WI"] });
    expect(parseStates("", avail).error).toBeTruthy();
    expect(parseStates("C", avail).error).toContain("Not a state code");
  });
});

describe("runImport", () => {
  it("sends one state in batches of 500, schools then venues, skipping unnamed rows", async () => {
    const { calls, rpc } = recorder();
    const out = await runImport({ ...base, src, states: ["CT"], rpc });
    // 1100 venues, 110 unnamed -> 990 sent: 500 + 490. 700 schools, 7 unnamed -> 693: 500 + 193.
    expect(calls.map((c) => `${c.fn}:${c.n}`)).toEqual(["upsert_schools:500", "upsert_schools:193", "upsert_venues:500", "upsert_venues:490"]);
    expect(out[0]!.venues).toMatchObject({ read: 1100, toSend: 990, unnamed: 110, inserted: 990, protected: 2, batches: 2 });
    expect(out[0]!.schools).toMatchObject({ read: 700, toSend: 693, unnamed: 7 });
    expect(out[0]!.sent).toBe(true);
  });
  it("sends nothing on a dry run, and needs no database", async () => {
    const { calls, rpc } = recorder();
    const out = await runImport({ ...base, src, states: ["CT", "NY"], rpc, dryRun: true });
    expect(calls).toHaveLength(0);
    expect(out.map((o) => o.state)).toEqual(["CT", "NY"]);
    expect(out[0]!.venues.toSend).toBe(990);
  });
  it("skips a state with an invalid setting and carries on, unless asked to skip only the bad rows", async () => {
    const { calls, rpc } = recorder();
    const out = await runImport({ ...base, src, states: ["NY", "WY"], rpc });
    expect(out[0]!.sent).toBe(false);
    expect(out[0]!.venues.invalid[0]).toContain("setting");
    expect(out[1]!.sent).toBe(true);
    expect(calls.every((c) => !(c.fn === "upsert_venues" && c.n === 2))).toBe(true);
    const again = recorder();
    const out2 = await runImport({ ...base, src, states: ["NY"], rpc: again.rpc, skipInvalid: true });
    expect(out2[0]!.sent).toBe(true);
    expect(again.calls.find((c) => c.fn === "upsert_venues")?.n).toBe(1);
    expect(totals(out).invalidStates).toBe(1);
  });
  it("imports unnamed rows only when asked", async () => {
    const { rpc } = recorder();
    const out = await runImport({ ...base, src, states: ["CT"], rpc, includeUnnamed: true, dryRun: true });
    expect(out[0]!.venues.toSend).toBe(1100);
    expect(out[0]!.venues.unnamed).toBe(0);
  });
  it("can import just one table", async () => {
    const { calls, rpc } = recorder();
    await runImport({ ...base, src, states: ["WY"], rpc, only: "venues" });
    expect(calls.map((c) => c.fn)).toEqual(["upsert_venues"]);
  });
  it("stops on a failed batch and says which state to repeat; a re-run sends the same rows (safe to repeat)", async () => {
    let n = 0;
    const flaky: RpcFn = async (_fn, rows) => {
      n += 1;
      if (n === 3) throw new Error("HTTP 500");
      return { inserted: rows.length, updated: 0, protected: 0 };
    };
    const lines: string[] = [];
    const out = await runImport({ ...base, src, states: ["CT", "WY"], rpc: flaky, log: (l) => lines.push(l) });
    expect(out).toHaveLength(1);
    expect(out[0]!.failed).toContain("HTTP 500");
    expect(lines.join("\n")).toContain("Re-run with --states CT");
    expect(totals(out).failed).toBe(1);
    const again = recorder();
    await runImport({ ...base, src, states: ["CT"], rpc: again.rpc });
    expect(again.calls.reduce((a, c) => a + c.n, 0)).toBe(693 + 990);
  });
  it("sums protected rows across states", async () => {
    const { rpc } = recorder();
    const out = await runImport({ ...base, src, states: ["CT", "WY"], rpc });
    expect(totals(out).venuesProtected).toBe(3);
  });
});
