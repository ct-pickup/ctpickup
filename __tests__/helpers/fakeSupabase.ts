/**
 * A tiny in-memory stand-in for the Supabase client, enough for the alert, push-policy and analytics tests.
 * Tables are arrays of rows. Supports select/insert/update/delete/upsert with eq, neq, in, is, not, gt/gte/lt/lte, order, range,
 * limit, single and maybeSingle, plus rpc handlers. Not a SQL engine: SQL itself is tested in __tests__/sql against a real Postgres.
 */
type Row = Record<string, unknown>;
type Err = { message: string; code?: string } | null;
type Filter = (r: Row) => boolean;

export type FakeDb = {
  tables: Record<string, Row[]>;
  /** Table name -> error message to return for every query on it (simulates a missing table or column). */
  failTables: Record<string, string>;
  rpcs: Record<string, (args: Row) => { data: unknown; error: Err } | Promise<{ data: unknown; error: Err }>>;
  rpcCalls: { name: string; args: Row }[];
};

export function makeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables, failTables: {}, rpcs: {}, rpcCalls: [] };
}

class Query implements PromiseLike<{ data: unknown; error: Err; count?: number | null }> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private wantsReturn = false;
  private head = false;
  private upsertConflict: string[] = [];
  private ignoreDuplicates = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode !== "select") this.wantsReturn = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(p: Row | Row[]) {
    this.mode = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = "upsert";
    this.payload = p;
    this.upsertConflict = (o?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.ignoreDuplicates = !!o?.ignoreDuplicates;
    return this;
  }
  update(p: Row) {
    this.mode = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (v === null ? r[c] == null : r[c] === v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v));
    else this.filters.push((r) => r[c] !== v);
    return this;
  }
  /** Accepted and ignored: the tests that use it pre-filter their rows. */
  or() {
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push((r) => String(r[c]) > String(v));
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push((r) => String(r[c]) >= String(v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push((r) => String(r[c]) < String(v));
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push((r) => String(r[c]) <= String(v));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orderBy = { col, asc: o?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(a: number, b: number) {
    this.rng = [a, b];
    return this;
  }

  private run(): { data: unknown; error: Err; count?: number | null } {
    const failure = this.db.failTables[this.table];
    if (failure) return { data: null, error: { message: failure, code: "42P01" } };
    const rows = (this.db.tables[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.mode === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const made = list.map((r) => ({ ...r }));
      rows.push(...made);
      return { data: this.wantsReturn ? made : null, error: null };
    }
    if (this.mode === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const out: Row[] = [];
      for (const r of list) {
        const hit = this.upsertConflict.length ? rows.find((x) => this.upsertConflict.every((k) => x[k] === r[k])) : undefined;
        if (hit) {
          if (!this.ignoreDuplicates) Object.assign(hit, r);
          out.push(hit);
        } else {
          const made = { ...r };
          rows.push(made);
          out.push(made);
        }
      }
      return { data: this.wantsReturn ? out : null, error: null };
    }
    if (this.mode === "update") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      return { data: this.wantsReturn ? hit : null, error: null };
    }
    if (this.mode === "delete") {
      const keep = rows.filter((r) => !match(r));
      const removed = rows.length - keep.length;
      this.db.tables[this.table] = keep;
      return { data: null, error: null, count: removed };
    }
    let out = rows.filter(match);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) out = out.slice(0, this.lim);
    return { data: this.head ? null : out, error: null, count: out.length };
  }

  maybeSingle() {
    const r = this.run();
    const list = (r.data as Row[] | null) ?? [];
    return Promise.resolve({ data: list[0] ? { ...list[0] } : null, error: r.error });
  }
  single() {
    return this.maybeSingle();
  }
  then<T1, T2>(ok?: ((v: { data: unknown; error: Err; count?: number | null }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

export function fakeClient(db: FakeDb) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (name: string, args: Row = {}) => {
      db.rpcCalls.push({ name, args });
      const fn = db.rpcs[name];
      if (!fn) return { data: null, error: { message: `function ${name} does not exist`, code: "42883" } };
      return await fn(args);
    },
  };
}

/** The JS twin of public.claim_push_slots, for tests that cannot run SQL. The SQL itself is tested in __tests__/sql. */
export function claimPushSlotsTwin(db: FakeDb, now: () => number = Date.now) {
  return (args: Row) => {
    const ids = [...new Set((args.p_user_ids as string[]) ?? [])];
    const bucket = args.p_bucket as string;
    const key = args.p_dedupe_key as string;
    const windowMs = Math.max(Number(args.p_window_hours ?? 0), 0) * 3_600_000;
    const ledger = (db.tables.push_ledger ??= []);
    const out: { user_id: string }[] = [];
    for (const id of ids) {
      const blocked = ledger.some((l) => l.user_id === id && l.bucket === bucket && (l.dedupe_key === key || now() - Number(l.sent_at) < windowMs));
      if (blocked) continue;
      ledger.push({ user_id: id, bucket, dedupe_key: key, sent_at: now() });
      out.push({ user_id: id });
    }
    return { data: out, error: null as Err };
  };
}
