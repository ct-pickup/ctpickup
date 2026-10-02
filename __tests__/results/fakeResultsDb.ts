type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

/**
 * In-memory PostgREST stand-in for the result, record and settle paths.
 * `missingColumns` / `missingTables` simulate migrations that have not run;
 * `notNull` simulates NOT NULL columns (winning_team before the draws migration).
 */
export class FakeResultsDb {
  tables: Record<string, Row[]> = {};
  missingColumns: Record<string, string[]> = {};
  missingTables = new Set<string>();
  notNull: Record<string, string[]> = {};
  rpcCalls: { name: string; args: unknown }[] = [];
  rpcHandler: (name: string, args: Record<string, unknown>) => Result = () => ({ data: null, error: null });
  queries: { table: string; op: string }[] = [];
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

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return this.rpcHandler(name, args);
  }
}

const PRIMARY_KEYS: Record<string, string[]> = {
  pickup_run_results: ["run_id"],
  player_ratings: ["user_id"],
  profiles: ["id"],
};

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private cols = "*";
  private payload: Row | Row[] | null = null;
  private one = false;
  private head = false;
  private wantCount = false;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private max: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private onConflict: string | null = null;
  private ignoreDuplicates = false;

  constructor(private db: FakeResultsDb, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.cols = cols;
    this.head = opts?.head === true;
    this.wantCount = Boolean(opts?.count);
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = opts?.onConflict ?? null;
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
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
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: null) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  not(col: string, op: string, val: null) {
    if (op !== "is") throw new Error(`fake not(): unsupported op ${op}`);
    this.filters.push((r) => (r[col] ?? null) !== val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  gte(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) >= (val as number));
    return this;
  }
  gt(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) > (val as number));
    return this;
  }
  lte(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) <= (val as number));
    return this;
  }
  lt(col: string, val: number | string) {
    this.filters.push((r) => (r[col] as number) < (val as number));
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
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    return this.maybeSingle();
  }

  private columnError(cols: string[]): Result | null {
    const gone = (this.db.missingColumns[this.table] ?? []).find((c) => cols.includes(c));
    return gone ? { data: null, error: { message: `column ${this.table}.${gone} does not exist`, code: "42703" } } : null;
  }

  private notNullError(row: Row): Result | null {
    const col = (this.db.notNull[this.table] ?? []).find((c) => c in row && row[c] == null);
    return col
      ? { data: null, error: { message: `null value in column "${col}" violates not-null constraint`, code: "23502" } }
      : null;
  }

  private exec(): Result {
    this.db.queries.push({ table: this.table, op: this.op });
    if (this.db.missingTables.has(this.table)) {
      return { data: null, error: { message: `relation "public.${this.table}" does not exist`, code: "42P01" } };
    }
    const rows = this.db.rows(this.table);

    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const raw of list) {
        const colErr = this.columnError(Object.keys(raw));
        if (colErr) return colErr;
        const nn = this.notNullError(raw);
        if (nn) return nn;
      }
      const keys = this.onConflict ? this.onConflict.split(",").map((k) => k.trim()) : PRIMARY_KEYS[this.table];
      const written: Row[] = [];
      for (const raw of list) {
        const existing = this.op === "upsert" && keys ? rows.find((r) => keys.every((k) => r[k] === raw[k])) : undefined;
        if (existing) {
          if (this.ignoreDuplicates) continue;
          Object.assign(existing, raw);
          written.push(existing);
        } else {
          const row = { created_at: new Date().toISOString(), ...raw };
          rows.push(row);
          written.push(row);
        }
      }
      return { data: this.one ? written[0] : written, error: null };
    }

    const matched = rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.op === "update") {
      const colErr = this.columnError(Object.keys(this.payload as Row));
      if (colErr) return colErr;
      for (const r of matched) Object.assign(r, this.payload);
      return { data: this.one ? (matched[0] ?? null) : matched, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r));
      return { data: null, error: null };
    }

    const requested = this.cols.split(",").map((c) => c.trim());
    const colErr = this.columnError(requested);
    if (colErr) return colErr;
    let out = [...matched];
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.rangeFrom != null && this.rangeTo != null) out = out.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.max != null) out = out.slice(0, this.max);
    const project = (r: Row) => (this.cols === "*" ? { ...r } : Object.fromEntries(requested.map((c) => [c, r[c] ?? null])));
    if (this.head) return { data: null, error: null, count: matched.length };
    if (this.one) return { data: out[0] ? project(out[0]) : null, error: null };
    return { data: out.map(project), error: null, count: this.wantCount ? matched.length : null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}
