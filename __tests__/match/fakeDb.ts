type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { message: string; code?: string } | null };

/** In-memory PostgREST stand-in for the match routes, with switchable missing columns/tables. */
export class FakeMatchDb {
  tables: Record<string, Row[]> = {};
  missingColumns: Record<string, string[]> = {};
  missingTables = new Set<string>();
  rateBuckets = new Map<string, number>();
  rpcFails = false;
  auth = {
    getUser: async (token: string) => ({ data: { user: token ? { id: token } : null }, error: null }),
  };

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: { p_bucket_key: string; p_limit: number }) {
    if (this.rpcFails || name !== "api_rate_limit_check") {
      return { data: null, error: { message: `Could not find the function public.${name}` } };
    }
    const n = (this.rateBuckets.get(args.p_bucket_key) ?? 0) + 1;
    if (n > args.p_limit) return { data: { allowed: false, retry_after_seconds: 1200 }, error: null };
    this.rateBuckets.set(args.p_bucket_key, n);
    return { data: { allowed: true, retry_after_seconds: 0 }, error: null };
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "delete" = "select";
  private cols = "*";
  private inserted: Row | null = null;
  private single = false;
  private max: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;

  constructor(private db: FakeMatchDb, private table: string) {}

  select(cols = "*") {
    this.cols = cols;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.inserted = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) >= val);
    return this;
  }
  lte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) <= val);
    return this;
  }
  not(col: string, op: string, val: null) {
    if (op !== "is") throw new Error(`fake not(): unsupported op ${op}`);
    this.filters.push((r) => (r[col] ?? null) !== val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private exec(): Result {
    if (this.db.missingTables.has(this.table)) {
      return { data: null, error: { message: `relation "public.${this.table}" does not exist`, code: "42P01" } };
    }
    const rows = this.db.rows(this.table);
    if (this.op === "insert") {
      const row = { ...this.inserted! };
      if (
        this.table === "pickup_run_host_invites" &&
        rows.some((r) => r.run_id === row.run_id && r.invitee_id === row.invitee_id)
      ) {
        return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      }
      rows.push(row);
      return { data: row, error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r));
      return { data: null, error: null };
    }
    const requested = this.cols.split(",").map((c) => c.trim());
    const gone = (this.db.missingColumns[this.table] ?? []).find((c) => requested.includes(c));
    if (gone) {
      return { data: null, error: { message: `column ${this.table}.${gone} does not exist`, code: "42703" } };
    }
    let out = [...matched];
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.max != null) out = out.slice(0, this.max);
    const project = (r: Row) =>
      this.cols === "*" ? { ...r } : Object.fromEntries(requested.map((c) => [c, r[c] ?? null]));
    if (this.single) return { data: out[0] ? project(out[0]) : null, error: null };
    return { data: out.map(project), error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}
