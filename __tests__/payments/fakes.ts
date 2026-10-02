import { afterEach, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** Pins Date (only) so payments seeded relative to now are on or after POLICY_CHANGE_AT. */
export function pinClock(iso = "2026-11-02T16:00:00Z") {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

type UniqueIndex = { table: string; key: (r: Row) => unknown[]; where?: (r: Row) => boolean };

const CANCELLED_RUN_PLAYER_UNIQUE: UniqueIndex = {
  table: "pickup_credits",
  key: (r) => [r.user_id, r.cancelled_run_id, r.credited_for_user_id ?? r.user_id],
  where: (r) => r.cancelled_run_id != null,
};
const CANCELLED_RUN_UNIQUE_BEFORE_MIGRATION: UniqueIndex = {
  table: "pickup_credits",
  key: (r) => [r.user_id, r.cancelled_run_id],
  where: (r) => r.cancelled_run_id != null,
};

/** Minimal in-memory stand-in for the PostgREST builder surface the pickup payment routes use. */
export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  failUpdates: { table: string; message: string }[] = [];
  deletes: string[] = [];
  uniques: UniqueIndex[] = [CANCELLED_RUN_PLAYER_UNIQUE];
  missingColumns: Record<string, string[]> = {};
  auth = {
    getUser: async (token: string) => ({ data: { user: token ? { id: token } : null }, error: null }),
  };
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new Query(this, table);
  }

  /** Schema as it is before 20261002160000_pickup_credits_credited_for.sql runs. */
  beforeCreditedForMigration() {
    this.uniques = [CANCELLED_RUN_UNIQUE_BEFORE_MIGRATION];
    this.missingColumns.pickup_credits = ["credited_for_user_id"];
  }

  nextId(): string {
    this.seq += 1;
    return `row_${this.seq}`;
  }
}

function parseOr(expr: string): Filter {
  const parts = expr.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const val = rest.join(".");
    if (op !== "eq") throw new Error(`fake or(): unsupported op ${op}`);
    return (r: Row) => String(r[col] ?? "") === val;
  });
  return (r) => parts.some((f) => f(r));
}

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Filter[] = [];
  private op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private conflictCols: string[] = [];
  private patch: Row | null = null;
  private inserted: Row | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private single = false;
  private returnRows = false;
  private selectCols: string[] = [];

  constructor(private db: FakeSupabase, private table: string) {}

  select(cols?: string) {
    if (this.op !== "select") this.returnRows = true;
    else this.selectCols = (cols ?? "*").split(",").map((c) => c.trim());
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.inserted = row;
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.inserted = row;
    this.conflictCols = (opts?.onConflict ?? "id").split(",").map((c) => c.trim());
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => {
      if (col.includes("->>")) {
        const [c, k] = col.split("->>");
        const obj = (r[c] ?? {}) as Row;
        return String(obj[k] ?? "") === String(val);
      }
      return r[col] === val;
    });
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
  or(expr: string) {
    this.filters.push(parseOr(expr));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private exec(): { data: unknown; error: { message: string; code?: string } | null } {
    const rows = this.db.rows(this.table);
    const missing = this.db.missingColumns[this.table] ?? [];
    if (this.op === "insert") {
      const absent = Object.keys(this.inserted ?? {}).find((c) => missing.includes(c));
      if (absent) {
        return { data: null, error: { message: `Could not find the '${absent}' column of '${this.table}' in the schema cache`, code: "PGRST204" } };
      }
      const row: Row = { id: this.db.nextId(), awarded_at: new Date().toISOString(), ...this.inserted };
      for (const u of this.db.uniques) {
        if (u.table !== this.table || (u.where && !u.where(row))) continue;
        const key = JSON.stringify(u.key(row));
        if (rows.some((r) => (!u.where || u.where(r)) && JSON.stringify(u.key(r)) === key)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
      }
      rows.push(row);
      return { data: row, error: null };
    }
    if (this.op === "upsert") {
      const fail = this.db.failUpdates.find((f) => f.table === this.table);
      if (fail) return { data: null, error: { message: fail.message } };
      const row = this.inserted!;
      const hit = rows.find((r) => this.conflictCols.every((c) => r[c] === row[c]));
      if (hit) Object.assign(hit, row);
      else rows.push({ ...row });
      return { data: null, error: null };
    }
    const absentSel = this.op === "select" ? this.selectCols.find((c) => missing.includes(c)) : undefined;
    if (absentSel) {
      return { data: null, error: { message: `column ${this.table}.${absentSel} does not exist`, code: "42703" } };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      const fail = this.db.failUpdates.find((f) => f.table === this.table);
      if (fail) return { data: null, error: { message: fail.message } };
      for (const r of matched) Object.assign(r, this.patch);
      return { data: this.returnRows ? matched : null, error: null };
    }
    if (this.op === "delete") {
      this.db.deletes.push(this.table);
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r));
      return { data: this.returnRows ? matched : null, error: null };
    }
    let out = [...matched];
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.single) return { data: out[0] ? { ...out[0] } : null, error: null };
    out = out.map((r) => ({ ...r }));
    return { data: out, error: null };
  }

  then<T1 = { data: unknown; error: { message: string; code?: string } | null }, T2 = never>(
    onfulfilled?: ((v: { data: unknown; error: { message: string; code?: string } | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}

type FakePi = {
  id: string;
  status: string;
  amount_received: number;
  amount_refunded: number;
  charge_created: number;
};

type FakeSession = { id: string; status: "open" | "complete" | "expired"; payment_status: string; payment_intent: string | null };

/** Stripe stand-in that honours idempotency keys the way Stripe does (same key returns the same refund). */
export class FakeStripe {
  pis = new Map<string, FakePi>();
  sessions = new Map<string, FakeSession>();
  refundsById = new Map<string, { id: string; amount: number; status: string; payment_intent: string }>();
  idem = new Map<string, string>();
  calls = { refundsCreate: 0, expire: 0, piCancel: 0 };
  nextRefundStatus = "succeeded";
  failRefundFor = new Set<string>();
  private n = 0;

  addPi(id: string, amountReceived: number, opts?: { status?: string; refunded?: number; chargeCreatedIso?: string }) {
    const createdMs = opts?.chargeCreatedIso ? new Date(opts.chargeCreatedIso).getTime() : Date.now();
    this.pis.set(id, {
      id,
      status: opts?.status ?? "succeeded",
      amount_received: amountReceived,
      amount_refunded: opts?.refunded ?? 0,
      charge_created: Math.floor(createdMs / 1000),
    });
  }

  paymentIntents = {
    retrieve: async (id: string) => {
      const pi = this.pis.get(id);
      if (!pi) throw new Error(`No such payment_intent: ${id}`);
      return {
        id,
        status: pi.status,
        amount_received: pi.amount_received,
        latest_charge: { id: `ch_${id}`, amount_refunded: pi.amount_refunded, created: pi.charge_created },
      };
    },
    cancel: async (id: string) => {
      this.calls.piCancel += 1;
      const pi = this.pis.get(id);
      if (!pi) throw new Error(`No such payment_intent: ${id}`);
      pi.status = "canceled";
      return { id, status: "canceled" };
    },
  };

  checkout = {
    sessions: {
      retrieve: async (id: string) => {
        const s = this.sessions.get(id);
        if (!s) throw new Error(`No such checkout session: ${id}`);
        return { ...s };
      },
      expire: async (id: string) => {
        this.calls.expire += 1;
        const s = this.sessions.get(id);
        if (!s) throw new Error(`No such checkout session: ${id}`);
        if (s.status !== "open") throw new Error("Only open sessions can be expired");
        s.status = "expired";
        return { ...s };
      },
    },
  };

  refunds = {
    create: async (params: { payment_intent: string; amount: number }, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey;
      if (key && this.idem.has(key)) return { ...this.refundsById.get(this.idem.get(key)!)! };
      this.calls.refundsCreate += 1;
      if (this.failRefundFor.has(params.payment_intent)) throw new Error("Your card was declined for refund (test)");
      const pi = this.pis.get(params.payment_intent);
      if (!pi) throw new Error(`No such payment_intent: ${params.payment_intent}`);
      if (params.amount > pi.amount_received - pi.amount_refunded) throw new Error("Refund amount exceeds charge");
      this.n += 1;
      const refund = { id: `re_${this.n}`, amount: params.amount, status: this.nextRefundStatus, payment_intent: pi.id };
      if (refund.status === "succeeded" || refund.status === "pending") pi.amount_refunded += params.amount;
      this.refundsById.set(refund.id, refund);
      if (key) this.idem.set(key, refund.id);
      return { ...refund };
    },
    retrieve: async (id: string) => {
      const r = this.refundsById.get(id);
      if (!r) throw new Error(`No such refund: ${id}`);
      return { ...r };
    },
    list: async (params: { payment_intent: string }) => ({
      data: [...this.refundsById.values()].filter((r) => r.payment_intent === params.payment_intent).reverse(),
    }),
  };
}
