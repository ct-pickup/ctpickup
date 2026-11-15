import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, stripeCalls: [] as Record<string, unknown>[] }));

vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => fakeClient(h.db as never),
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: "cap-user", email: "c@example.com" } }, error: null }) } }),
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
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/payments/recordCheckoutStarted", () => ({ recordPlatformCheckoutStarted: async () => undefined }));

import { POST as checkout } from "../../app/api/stripe/create-checkout-session/route";
import {
  TOURNAMENT_PRICE_PER_PLAYER_CENTS,
  captainEntryCents,
  chargedPlayers,
  checkoutProductName,
  formatUsd,
  payButtonText,
  perPlayerText,
  teamPriceRangeText,
  teamTotalText,
} from "../../shared/tournamentPrice";

/**
 * What a captain is charged was, before this change, worked out inline in the checkout route:
 *   expected = Number(expected_players ?? 0) || 10;  headcount = max(5, min(25, expected));  fee = headcount * 5000
 * This is a copy of that formula, kept ONLY here, so the test can prove the shared function charges exactly what the old code charged.
 */
function legacyChargeCents(expectedPlayers: unknown): number {
  const expected = Number(expectedPlayers ?? 0) || 10;
  const headcount = Math.max(5, Math.min(25, expected));
  return headcount * 5000;
}
const legacyName = (n: number) => `Competitive Together Tournament Entry — ${n} players × $50`;

function world(expected: unknown): FakeDb {
  return makeDb({
    tournament_captains: [
      { id: "cap1", user_id: "cap-user", status: "payment_pending", captain_verified: true, expected_players: expected, payment_due_at: new Date(Date.now() + 3_600_000).toISOString(), tournaments: { id: "t1", is_active: true, title: "Spring", entry_fee_cents: 99999 } },
    ],
    tournament_payments: [],
  });
}
const call = () => checkout(new Request("https://site.test/api/stripe/create-checkout-session", { method: "POST", headers: { authorization: "Bearer t" } }));

beforeEach(() => {
  h.stripeCalls = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("1. what Stripe charges is exactly what it charged before", () => {
  it("for every claimed team size from 5 to 25 the checkout asks Stripe for the old amount, the old name and the old player count", async () => {
    for (let n = 5; n <= 25; n++) {
      h.db = world(n);
      h.stripeCalls = [];
      const res = await call();
      expect(res.status, `size ${n}`).toBe(200);
      const args = h.stripeCalls[0] as { line_items: { quantity: number; price_data: { currency: string; unit_amount: number; product_data: { name: string } } }[]; metadata: Record<string, string> };
      const item = args.line_items[0]!;
      expect(item.price_data.unit_amount, `size ${n}`).toBe(legacyChargeCents(n));
      expect(item.price_data.unit_amount).toBe(n * 5000);
      expect(item.price_data.currency).toBe("usd");
      expect(item.quantity).toBe(1);
      expect(item.price_data.product_data.name).toBe(legacyName(n));
      expect(args.metadata.players_count).toBe(String(n));
      expect((h.db as FakeDb).tables.tournament_payments![0]).toMatchObject({ amount_cents: n * 5000, players_count: n });
    }
  });

  it("the entry fee column on the tournament is never used: a tournament saying $999.99 is still charged players x $50", async () => {
    h.db = world(12);
    await call();
    const item = (h.stripeCalls[0] as { line_items: { price_data: { unit_amount: number } }[] }).line_items[0]!;
    expect(item.price_data.unit_amount).toBe(60000);
  });

  it("odd claims are charged the same as before: missing or zero is 10 players, below 5 is 5, above 25 is 25", async () => {
    for (const [claimed, players] of [[undefined, 10], [null, 10], [0, 10], ["", 10], ["abc", 10], [3, 5], [1, 5], [26, 25], [99, 25], ["12", 12]] as const) {
      h.db = world(claimed);
      h.stripeCalls = [];
      await call();
      const item = (h.stripeCalls[0] as { line_items: { price_data: { unit_amount: number; product_data: { name: string } } }[] }).line_items[0]!;
      expect(item.price_data.unit_amount, String(claimed)).toBe(legacyChargeCents(claimed));
      expect(item.price_data.unit_amount).toBe(players * 5000);
      expect(item.price_data.product_data.name).toBe(legacyName(players));
    }
  });
});

describe("1. every number a screen shows equals the number charged", () => {
  it("for sizes 5 to 25 the pay button, the team total line and the shared function all name the charged dollars", () => {
    for (let n = 5; n <= 25; n++) {
      const charged = legacyChargeCents(n);
      const dollars = formatUsd(charged);
      expect(captainEntryCents(n)).toBe(charged);
      expect(chargedPlayers(n)).toBe(n);
      expect(payButtonText(n)).toBe(`Proceed to payment (${dollars})`);
      expect(teamTotalText(n)).toBe(`${dollars} for ${n} players (${perPlayerText()})`);
      expect(checkoutProductName(n)).toBe(legacyName(n));
    }
  });

  it("the per player price and the range text come from the same constant the charge uses", () => {
    expect(TOURNAMENT_PRICE_PER_PLAYER_CENTS).toBe(5000);
    expect(perPlayerText()).toBe("$50 per player");
    expect(teamPriceRangeText()).toBe(`${formatUsd(legacyChargeCents(5))} to ${formatUsd(legacyChargeCents(25))} per team (5 to 25 players)`);
    expect(teamPriceRangeText()).toBe("$250 to $1,250 per team (5 to 25 players)");
  });

  it("a claim with a missing size shows the same dollars the checkout will charge (10 players)", () => {
    expect(payButtonText(undefined)).toBe(`Proceed to payment (${formatUsd(legacyChargeCents(undefined))})`);
    expect(payButtonText(undefined)).toBe("Proceed to payment ($500)");
  });
});

describe("1. no screen carries its own copy of the price", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const SCREENS = [
    "app/tournament/page.tsx",
    "app/admin/tournament/page.tsx",
    "mobile/components/CaptainClaimModal.tsx",
    "mobile/app/field-tournament.tsx",
    "mobile/app/(tabs)/admin/tournament.tsx",
    "app/api/tournament/public/route.ts",
    "app/api/stripe/create-checkout-session/route.ts",
  ];

  it("none of them hard codes the $50, the 5000 cents, the 5 to 25 clamp or the old $250 default", () => {
    for (const f of SCREENS) {
      const src = read(f);
      expect(src, f).not.toMatch(/\*\s*5000\b|\*\s*50\b|\$250\b|25000\b/);
      expect(src, f).not.toMatch(/Math\.max\(5,\s*Math\.min\(25/);
      expect(src, f).toMatch(/tournamentPrice/);
    }
  });

  it("the admin create forms no longer ask for an entry fee, and the routes no longer write one", () => {
    expect(read("mobile/app/(tabs)/admin/tournament.tsx")).not.toMatch(/createEntryFee|entry_fee_cents/);
    expect(read("app/admin/tournament/actions.ts")).not.toMatch(/entry_fee/);
    expect(read("app/api/admin/tournaments/route.ts")).not.toMatch(/entry_fee/);
  });

  it("the public route reports the real price, never the column", () => {
    const src = read("app/api/tournament/public/route.ts");
    expect(src).not.toMatch(/t\.entry_fee_cents/);
    expect(src).toMatch(/captainEntryCents\(TOURNAMENT_MIN_CHARGED_PLAYERS\)/);
    expect(src).toMatch(/price: tournamentPriceInfo\(\)/);
  });
});
