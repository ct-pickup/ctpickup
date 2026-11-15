import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({
  db: null as unknown,
  user: "admin1",
  stripeCalls: [] as Record<string, unknown>[],
  pushes: [] as { ids: string[]; msg: Record<string, unknown> }[],
  rooms: [] as unknown[][],
}));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/admin/requireAdmin", () => ({
  requireAdminBearer: async () => ({ ok: true, userId: "admin1" }),
}));
vi.mock("@/lib/chat/tournamentTeamRoom", () => ({
  ensureTournamentTeamRoom: async (...a: unknown[]) => {
    h.rooms.push(a.slice(1));
    return null;
  },
}));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_admin: unknown, ids: string[], msg: Record<string, unknown>) => {
    h.pushes.push({ ids, msg });
  },
}));
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/payments/recordCheckoutStarted", () => ({ recordPlatformCheckoutStarted: async () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => fakeClient(h.db as never),
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: h.user } }, error: null }) } }),
    getStripeTournament: () => ({
      checkout: {
        sessions: {
          create: async (args: Record<string, unknown>) => {
            h.stripeCalls.push(args);
            return { id: "cs_test_1", url: "https://stripe.test/pay", payment_intent: null };
          },
        },
      },
    }),
  };
});

import { GET as adminGet, POST as adminPost } from "../../app/api/admin/tournaments/route";
import { GET as paymentInfo } from "../../app/api/tournament/captain/payment-info/route";
import { GET as publicGet } from "../../app/api/tournament/public/route";
import { POST as checkout } from "../../app/api/stripe/create-checkout-session/route";
import { markCaptainPaid, undoCaptainPaid } from "../../lib/tournament/manualPayment";
import { isMissingColumn, loadPaymentConfig } from "../../lib/tournament/paymentConfig";
import {
  CREATE_DATE_PLACEHOLDER,
  MANUAL_APPROVED_TITLE,
  PAYMENT_INSTRUCTIONS_MAX,
  PAYMENT_MODE_OPTIONS,
  captainPaymentView,
  cleanPaymentInstructions,
  entryFeeNote,
  markPaidConfirmText,
  owedText,
  parsePaymentMode,
  undoPaidConfirmText,
} from "../../shared/tournamentPayment";
import { fakeClient } from "../helpers/fakeSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const T = "t1";
const SECRET = "Venmo @organizer-secret-handle";
const future = () => new Date(Date.now() + 3_600_000).toISOString();

function world(o: { mode?: string | null; slug?: string; captain?: Record<string, unknown>; matches?: boolean; noColumns?: boolean } = {}): FakeDb {
  const t: Record<string, unknown> = { id: T, slug: o.slug ?? "fall-classic", title: "Fall Classic", is_active: true, canceled_at: null, entry_fee_cents: 99999 };
  if (!o.noColumns) {
    t.payment_mode = o.mode === undefined ? "manual" : o.mode;
    t.payment_instructions = SECRET;
  }
  return makeDb({
    tournaments: [t],
    tournament_captains: [
      { id: "c1", tournament_id: T, user_id: "cap-user", status: "claim_submitted", captain_verified: true, team_name: "Reds", captain_name: "Rae", expected_players: 12, payment_due_at: future(), tournaments: { id: T, is_active: true, title: "Fall Classic", entry_fee_cents: 99999 }, ...(o.captain ?? {}) },
      { id: "c2", tournament_id: T, user_id: "other-user", status: "claim_submitted", captain_verified: true, team_name: "Blues", captain_name: "Bo", expected_players: 8 },
    ],
    tournament_roster: [],
    tournament_payments: [],
    tournament_matches: o.matches ? [{ id: "m1", tournament_id: T }] : [],
    admin_audit_log: [],
  });
}
const tables = () => (h.db as FakeDb).tables;
const cap = (id = "c1") => tables().tournament_captains!.find((r) => r.id === id)!;
const admin = () => fakeClient(h.db as never) as unknown as SupabaseClient;
const mark = (captainId = "c1") => markCaptainPaid(admin(), { tournamentId: T, captainId, actorId: "admin1" });
const undo = (captainId = "c1") => undoCaptainPaid(admin(), { tournamentId: T, captainId, actorId: "admin1" });
const post = async (body: Record<string, unknown>) => {
  const res = await adminPost(new Request("https://site.test/api/admin/tournaments", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const info = async (user = "cap-user") => {
  h.user = user;
  const res = await paymentInfo(new Request(`https://site.test/api/tournament/captain/payment-info?tournament_id=${T}`, { headers: { authorization: "Bearer t" } }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const checkoutCall = () => { h.user = "cap-user"; return checkout(new Request("https://site.test/api/stripe/create-checkout-session", { method: "POST", headers: { authorization: "Bearer t" } })); };

beforeEach(() => {
  h.user = "admin1";
  h.stripeCalls = [];
  h.pushes = [];
  h.rooms = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  h.db = world();
});

describe("1. choosing how captains pay when creating a tournament", () => {
  const base = { action: "create", title: "Spring Open", target_teams: 8, official_threshold: 8, max_teams: 8 };

  it("anything that is not exactly manual reads as Stripe", () => {
    expect(parsePaymentMode("manual")).toBe("manual");
    expect(parsePaymentMode(" Manual ")).toBe("manual");
    for (const v of [undefined, null, "", "stripe", "venmo", "manual2", 1, true, {}]) expect(parsePaymentMode(v), String(v)).toBe("stripe");
  });

  it("the form offers exactly two plain choices under one question", () => {
    expect(PAYMENT_MODE_OPTIONS.map((o) => o.mode)).toEqual(["stripe", "manual"]);
    expect(PAYMENT_MODE_OPTIONS.map((o) => o.label)).toEqual(["In the app (Stripe)", "I collect it myself (Venmo or cash)"]);
  });

  it("creating a Stripe tournament writes nothing new to the row (exactly as before)", async () => {
    h.db = makeDb({ tournaments: [] });
    const r = await post({ ...base, payment_mode: "stripe", payment_instructions: "ignored" });
    expect(r.status).toBe(200);
    const row = tables().tournaments![0]!;
    expect("payment_mode" in row).toBe(false);
    expect("payment_instructions" in row).toBe(false);
  });

  it("omitting the choice behaves as Stripe", async () => {
    h.db = makeDb({ tournaments: [] });
    expect((await post(base)).status).toBe(200);
    expect("payment_mode" in tables().tournaments![0]!).toBe(false);
  });

  it("a manual tournament stores the mode and the cleaned instructions", async () => {
    h.db = makeDb({ tournaments: [] });
    const r = await post({ ...base, payment_mode: "manual", payment_instructions: `  ${SECRET}\u0007  ` });
    expect(r.status).toBe(200);
    expect(tables().tournaments![0]).toMatchObject({ payment_mode: "manual", payment_instructions: SECRET });
  });

  it("manual with no instructions is allowed (they are optional)", async () => {
    h.db = makeDb({ tournaments: [] });
    expect((await post({ ...base, payment_mode: "manual" })).status).toBe(200);
    expect(tables().tournaments![0]!.payment_mode).toBe("manual");
    expect("payment_instructions" in tables().tournaments![0]!).toBe(false);
  });

  it("before the database update is applied, a manual create says so plainly and creates nothing", async () => {
    h.db = makeDb({ tournaments: [] });
    (h.db as FakeDb).failTables.tournaments = 'column "payment_mode" of relation "tournaments" does not exist';
    const r = await post({ ...base, payment_mode: "manual" });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("needs_migration");
  });

  it("instructions are cleaned and capped", () => {
    expect(cleanPaymentInstructions("   ")).toBeNull();
    expect(cleanPaymentInstructions(null)).toBeNull();
    expect(cleanPaymentInstructions("a\u0000b\u0007c")).toBe("abc");
    expect(cleanPaymentInstructions("x".repeat(PAYMENT_INSTRUCTIONS_MAX + 50))!.length).toBe(PAYMENT_INSTRUCTIONS_MAX);
  });

  it("how captains pay cannot change once a team has paid or started to pay", async () => {
    tables().tournament_captains![0]!.status = "payment_pending";
    const r = await post({ action: "set_payment_options", tournament_id: T, payment_mode: "stripe" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("payment_started");
    expect(tables().tournaments![0]!.payment_mode).toBe("manual");
    // the instructions text may still be fixed
    expect((await post({ action: "set_payment_options", tournament_id: T, payment_instructions: "Venmo @new" })).status).toBe(200);
    expect(tables().tournaments![0]!.payment_instructions).toBe("Venmo @new");
  });
});

describe("2. a manual tournament never starts a Stripe checkout", () => {
  it("refuses with a plain message, calls Stripe zero times and writes nothing", async () => {
    tables().tournament_captains![0]!.status = "claim_submitted";
    const before = JSON.stringify(tables().tournament_captains);
    const res = await checkoutCall();
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string; message: string };
    expect(j.error).toBe("payments_handled_outside_app");
    expect(j.message).toContain("handled outside the app");
    expect(j.message).toContain("You have not been charged");
    expect(h.stripeCalls).toHaveLength(0);
    expect(tables().tournament_payments).toHaveLength(0);
    expect(JSON.stringify(tables().tournament_captains)).toBe(before);
  });

  it("refuses even an approved captain whose status is payment_pending", async () => {
    tables().tournament_captains![0]!.status = "payment_pending";
    expect((await checkoutCall()).status).toBe(409);
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("if the tournament's payment setting cannot be read, it refuses rather than guess", async () => {
    h.db = world({ mode: "stripe" });
    (h.db as FakeDb).tables.tournament_captains![0]!.status = "payment_pending";
    const original = (h.db as FakeDb).failTables;
    // reads of the tournaments table fail only for the config lookup: simulate by failing the table after the captain is loaded
    // (the captain row carries its own copy of the tournament, so the route reaches the config check first)
    original.tournaments = "connection lost";
    const res = await checkoutCall();
    expect(res.status).toBe(503);
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("a Stripe tournament is charged exactly as before, for every team size 5 to 25", async () => {
    for (let n = 5; n <= 25; n++) {
      h.db = world({ mode: "stripe", captain: { status: "payment_pending", expected_players: n } });
      h.stripeCalls = [];
      const res = await checkoutCall();
      expect(res.status, `size ${n}`).toBe(200);
      const args = h.stripeCalls[0] as { line_items: { quantity: number; price_data: { currency: string; unit_amount: number; product_data: { name: string } } }[]; metadata: Record<string, string> };
      expect(args.line_items[0]!.price_data.unit_amount).toBe(n * 5000);
      expect(args.line_items[0]!.price_data.currency).toBe("usd");
      expect(args.line_items[0]!.quantity).toBe(1);
      expect(args.line_items[0]!.price_data.product_data.name).toBe(`Competitive Together Tournament Entry — ${n} players × $50`);
      expect(args.metadata.players_count).toBe(String(n));
    }
  });

  it("a database without the new columns still charges as Stripe (nothing changes before the update is applied)", async () => {
    h.db = world({ noColumns: true, captain: { status: "payment_pending" } });
    expect((await checkoutCall()).status).toBe(200);
    expect(h.stripeCalls).toHaveLength(1);
  });

  it("the config reader treats a missing column as Stripe and any other failure as unavailable", async () => {
    const db = makeDb({ tournaments: [] });
    db.failTables.tournaments = "column tournaments.payment_mode does not exist";
    expect(await loadPaymentConfig(fakeClient(db) as never, T)).toMatchObject({ ok: true, mode: "stripe", columns_missing: true });
    db.failTables.tournaments = "connection lost";
    expect((await loadPaymentConfig(fakeClient(db) as never, T)).ok).toBe(false);
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn({ message: "boom" })).toBe(false);
  });
});

describe("3. what a captain sees, and when", () => {
  it("only an approved, unpaid captain gets the instructions", async () => {
    const r = await info();
    expect(r.json).toEqual({ mode: "manual", approved: true, paid: false, instructions: SECRET });
  });

  it("an unapproved captain gets no instructions", async () => {
    tables().tournament_captains![0]!.captain_verified = false;
    const r = await info();
    expect(r.json.instructions).toBeNull();
    expect(r.json.approved).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain("secret");
  });

  it("a rejected or expired claim gets none", async () => {
    for (const status of ["claim_rejected", "released_expired"]) {
      tables().tournament_captains![0]!.status = status;
      expect((await info()).json.instructions, status).toBeNull();
    }
  });

  it("a paid team no longer needs them", async () => {
    tables().tournament_captains![0]!.status = "payment_received";
    const r = await info();
    expect(r.json).toMatchObject({ approved: true, paid: true, instructions: null });
  });

  it("someone with no claim gets nothing, and nobody sees another team's state", async () => {
    const r = await info("stranger");
    expect(r.json).toEqual({ mode: "manual", approved: false, paid: false, instructions: null });
    expect(Object.keys((await info()).json).sort()).toEqual(["approved", "instructions", "mode", "paid"]);
  });

  it("a Stripe tournament never returns instructions", async () => {
    h.db = world({ mode: "stripe" });
    expect((await info()).json.instructions).toBeNull();
  });

  it("the public tournament route says only the mode, never the instructions", async () => {
    h.db = world();
    const res = await publicGet(new Request("https://site.test/api/tournament/public"));
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("payment_instructions");
    expect(text).not.toContain("Venmo");
    expect(JSON.parse(text).tournament?.payment_mode ?? "manual").toBe("manual");
  });

  it("the screen wording by state", () => {
    expect(captainPaymentView({ mode: "stripe", approved: true, paid: false, instructions: "x" }).kind).toBe("stripe");
    expect(captainPaymentView({ mode: "manual", approved: false, paid: false, instructions: SECRET })).toMatchObject({ kind: "manual_waiting_for_approval" });
    expect(JSON.stringify(captainPaymentView({ mode: "manual", approved: false, paid: false, instructions: SECRET }))).not.toContain("Venmo");
    const ok = captainPaymentView({ mode: "manual", approved: true, paid: false, instructions: SECRET });
    expect(ok).toMatchObject({ kind: "manual_approved", title: MANUAL_APPROVED_TITLE, instructions: SECRET });
    expect(MANUAL_APPROVED_TITLE).toBe("Approved. Send payment as described below, then wait for confirmation.");
    expect(captainPaymentView({ mode: "manual", approved: true, paid: true, instructions: SECRET }).kind).toBe("manual_paid");
  });
});

describe("4. Mark paid does what a card payment does", () => {
  it("sets the same status the webhook sets, plus payment_method manual, and unlocks the same things", async () => {
    const r = await mark();
    expect(r).toMatchObject({ ok: true, changed: true, status: "payment_received" });
    expect(cap()).toMatchObject({ status: "payment_received", payment_method: "manual" });
    expect(typeof cap().payment_received_at).toBe("string");
    expect(h.rooms).toHaveLength(1);
    expect(h.rooms[0]).toEqual(["c1", T, "Reds", "cap-user"]);
  });

  it("sends the same push the card payment sends, to that captain only", async () => {
    await mark();
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]!.ids).toEqual(["cap-user"]);
    expect(h.pushes[0]!.msg).toEqual({
      title: "Payment received",
      body: "Your team spot is confirmed. Build your roster in the Tournaments tab.",
      data: { kind: "tournament_captain_payment_confirmed", captain_id: "c1", tournament_id: T },
    });
  });

  it("the webhook's confirmation text and ours are the same words", () => {
    const hook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
    expect(hook).toContain('"Payment received"');
    expect(hook).toContain("Your team spot is confirmed. Build your roster in the Tournaments tab.");
    expect(hook).toContain("tournament_captain_payment_confirmed");
  });

  it("pressing it twice changes nothing the second time (no second chat room, no second message)", async () => {
    await mark();
    const second = await mark();
    expect(second).toMatchObject({ ok: true, changed: false });
    expect(h.rooms).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
    expect(tables().admin_audit_log).toHaveLength(1);
  });

  it("never touches the card payment records", async () => {
    await mark();
    expect(tables().tournament_payments).toEqual([]);
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("is refused for a Stripe tournament, an unapproved claim, and a rejected or expired claim", async () => {
    h.db = world({ mode: "stripe" });
    expect(await mark()).toMatchObject({ ok: false, code: "not_manual", status: 409 });
    h.db = world({ captain: { captain_verified: false } });
    expect(await mark()).toMatchObject({ ok: false, code: "not_approved" });
    for (const status of ["claim_rejected", "released_expired"]) {
      h.db = world({ captain: { status } });
      expect(await mark(), status).toMatchObject({ ok: false, code: "claim_closed" });
    }
    expect(h.pushes).toHaveLength(0);
  });

  it("refuses a team from a different tournament", async () => {
    tables().tournament_captains![0]!.tournament_id = "other";
    expect(await mark()).toMatchObject({ ok: false, code: "not_found", status: 404 });
  });

  it("writes one line saying who marked whom, and when", async () => {
    await mark();
    expect(tables().admin_audit_log).toHaveLength(1);
    expect(tables().admin_audit_log![0]).toMatchObject({ actor_id: "admin1", action: "tournament_mark_paid" });
    expect((tables().admin_audit_log![0]!.detail as Record<string, unknown>)).toMatchObject({ tournament_id: T, captain_id: "c1", team_name: "Reds", previous_status: "claim_submitted" });
  });

  it("a test- tournament is marked the same way but sends no push", async () => {
    h.db = world({ slug: "test-run" });
    const r = await mark();
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(cap().status).toBe("payment_received");
    expect(h.pushes).toHaveLength(0);
  });

  it("works through the admin API and reports the new status", async () => {
    const r = await post({ action: "mark_captain_paid", tournament_id: T, captain_id: "c1" });
    expect(r).toMatchObject({ status: 200, json: { ok: true, changed: true, status: "payment_received" } });
    expect((await post({ action: "mark_captain_paid", tournament_id: T })).status).toBe(400);
  });

  it("the confirm texts name the team", () => {
    expect(markPaidConfirmText("Reds")).toBe("Mark Reds as paid? They can then invite players.");
    expect(undoPaidConfirmText("Reds")).toContain("Reds");
  });
});

describe("5. Undo paid", () => {
  it("puts a manually paid team back to approved and unpaid, and records it", async () => {
    await mark();
    const r = await undo();
    expect(r).toMatchObject({ ok: true, changed: true, status: "claim_submitted" });
    expect(cap()).toMatchObject({ status: "claim_submitted", payment_method: null, payment_received_at: null, captain_verified: true });
    expect(tables().admin_audit_log!.map((a) => a.action)).toEqual(["tournament_mark_paid", "tournament_undo_paid"]);
    expect((await undo())).toMatchObject({ ok: true, changed: false });
  });

  it("never undoes a card payment", async () => {
    tables().tournament_captains![0]!.status = "payment_received";
    tables().tournament_captains![0]!.payment_method = "stripe";
    expect(await undo()).toMatchObject({ ok: false, code: "not_manual_payment" });
    expect(cap().status).toBe("payment_received");
  });

  it("is refused once the bracket exists", async () => {
    await mark();
    tables().tournament_matches!.push({ id: "m1", tournament_id: T });
    expect(await undo()).toMatchObject({ ok: false, code: "bracket_exists" });
    expect(cap().status).toBe("payment_received");
  });
});

describe("6. what the admin sees", () => {
  const list = async () => {
    const res = await adminGet(new Request("https://site.test/api/admin/tournaments?include=panel", { headers: { authorization: "Bearer t" } }));
    return (await res.json()) as { captains?: { id: string; paid: boolean; owed_cents: number; payment_method?: string | null }[] };
  };

  it("each team shows paid or not, and what it owes (players x $50)", async () => {
    await mark("c1");
    const r = await list();
    const c1 = r.captains!.find((c) => c.id === "c1")!;
    const c2 = r.captains!.find((c) => c.id === "c2")!;
    expect(c1).toMatchObject({ paid: true, owed_cents: 12 * 5000, payment_method: "manual" });
    expect(c2).toMatchObject({ paid: false, owed_cents: 8 * 5000 });
  });

  it("the owed words give the dollars and the sum", () => {
    expect(owedText(12)).toBe("Owes $600 (12 players × $50)");
    expect(owedText(undefined)).toBe("Owes $500 (10 players × $50)");
  });
});

describe("7. wording", () => {
  it("the fee note says whether the app charges anyone", () => {
    expect(entryFeeNote("manual")).toBe("You collect payment yourself. Captains are not charged in the app.");
    expect(entryFeeNote("stripe")).toContain("charged for the team size each captain claims");
    expect(entryFeeNote("stripe")).not.toContain("collect payment yourself");
  });

  it("tournament date boxes do not mention the availability poll", () => {
    expect(CREATE_DATE_PLACEHOLDER).toBe("Select date and time");
    const picker = readFileSync("mobile/components/DateTimePicker.tsx", "utf8");
    expect(picker).toContain('(placeholder ?? "Select poll date first")');
    const form = readFileSync("mobile/app/(tabs)/admin/tournament.tsx", "utf8");
    expect(form.match(/placeholder=\{CREATE_DATE_PLACEHOLDER\}/g)).toHaveLength(2);
  });
});

describe("8. nothing else moved", () => {
  it("the Stripe webhook file is byte for byte what main has", async () => {
    const { execFileSync } = await import("node:child_process");
    const diff = execFileSync("git", ["diff", "--stat", "origin/main", "--", "app/api/stripe/webhook/route.ts"], { encoding: "utf8" });
    expect(diff.trim()).toBe("");
  });

  it("the migration is additive, guarded, and says how to undo it", () => {
    const sql = readFileSync("supabase/migrations/20261107000000_tournament_manual_payments.sql", "utf8");
    expect(sql.toLowerCase()).toContain("rollback");
    expect(sql).toContain("to_regclass('public.tournaments')");
    expect(sql).toMatch(/payment_mode text not null default 'stripe'/i);
    expect(sql).toMatch(/payment_instructions text/i);
    expect(sql.toLowerCase()).not.toMatch(/drop table|delete from|truncate/);
  });

  it("the new files use no em dashes", () => {
    for (const f of ["shared/tournamentPayment.ts", "lib/tournament/paymentConfig.ts", "lib/tournament/manualPayment.ts", "app/api/tournament/captain/payment-info/route.ts", "supabase/migrations/20261107000000_tournament_manual_payments.sql"]) {
      expect(readFileSync(f, "utf8").includes("—"), f).toBe(false);
    }
  });
});
