import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { paymentIntentIdFromCheckoutSession } from "@/lib/payments/stripeSessionIds";
import { recordPlatformCheckoutStarted } from "@/lib/payments/recordCheckoutStarted";
import { IN_PERSON_TOURNAMENT_CAPTAIN_STRIPE_DESCRIPTION } from "@/lib/fees/refundPolicyCopy";
import {
  getStripeTournament,
  getSupabaseAdmin,
  getSupabaseAnon,
} from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

async function expireIfOverdue(captain: any, admin: SupabaseClient) {
  if (captain.status !== "payment_pending") return captain;
  if (!captain.payment_due_at) return captain;
  if (new Date(captain.payment_due_at).getTime() > Date.now()) return captain;

  await admin.from("tournament_captains").update({ status: "released_expired" }).eq("id", captain.id);

  return { ...captain, status: "released_expired" };
}

export async function POST(req: Request) {
  try {
    const stripe = getStripeTournament();
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
    if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

    const { data: u, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

    const waiverOk = await userHasAcceptedCurrentWaiver(u.user.id);
    if (!waiverOk) {
      return NextResponse.json({ error: "waiver_required" }, { status: 403 });
    }

    const { data: capRows, error: capListErr } = await admin
      .from("tournament_captains")
      .select("*, tournaments(id,is_active,title,entry_fee_cents)")
      .eq("user_id", u.user.id);

    if (capListErr) return NextResponse.json({ error: capListErr.message }, { status: 500 });

    const row = (capRows || []).find((r: { tournaments?: unknown }) => {
      const raw = r.tournaments as unknown;
      const tdata = (Array.isArray(raw) ? raw[0] : raw) as { is_active?: boolean } | null | undefined;
      return !!tdata?.is_active;
    });
    if (!row) return NextResponse.json({ error: "no_captain_claim" }, { status: 409 });

    const rawT = row.tournaments as unknown;
    const t = (Array.isArray(rawT) ? rawT[0] : rawT) as {
      id: string;
      is_active: boolean;
      title: string | null;
      entry_fee_cents?: number;
    };
    const captain = row as Record<string, unknown> & { id: string; status: string; captain_verified?: boolean };

    const cap = await expireIfOverdue(captain, admin);
    if (cap.status === "released_expired") {
      return NextResponse.json({ error: "claim_expired_reclaim" }, { status: 409 });
    }

    if (!cap.captain_verified) {
      return NextResponse.json({ error: "captain_not_verified" }, { status: 409 });
    }

    if (cap.status === "confirmed") {
      return NextResponse.json({ error: "already_confirmed" }, { status: 409 });
    }

    const now = new Date();
    const due = new Date(now.getTime() + 36 * 60 * 60 * 1000);

    await admin
      .from("tournament_captains")
      .update({
        status: "payment_pending",
        payment_requested_at: now.toISOString(),
        payment_due_at: due.toISOString(),
      })
      .eq("id", cap.id);

    const origin = requestSiteUrlFromRequest(req);

    const expectedPlayers = Number((cap as { expected_players?: unknown }).expected_players ?? 0) || 10;
    const rosterHeadcount = Math.max(5, Math.min(25, expectedPlayers));
    const feeCents = rosterHeadcount * 5000;

    const sessionMetadata = {
      kind: "tournament" as const,
      tournament_id: String(t.id),
      captain_id: String(cap.id),
      user_id: String(u.user.id),
      players_count: String(rosterHeadcount),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: feeCents,
            product_data: {
              name: `CT Pickup Tournament Entry — ${rosterHeadcount} players × $50`,
              description: IN_PERSON_TOURNAMENT_CAPTAIN_STRIPE_DESCRIPTION,
            },
          },
        },
      ],
      success_url: `${origin}/tournament?paid=1`,
      cancel_url: `${origin}/tournament?canceled=1`,
      customer_email: u.user.email || undefined,
      client_reference_id: cap.id,
      metadata: { ...sessionMetadata },
      payment_intent_data: {
        metadata: { ...sessionMetadata },
      },
    });

    console.log(
      JSON.stringify({
        stripe_checkout: true,
        flow: "tournament",
        checkout_session_id: session.id,
        captain_id: cap.id,
      }),
    );

    await admin.from("tournament_payments").insert({
      tournament_id: t.id,
      captain_id: cap.id,
      method: "stripe",
      amount_cents: feeCents,
      players_count: rosterHeadcount,
      stripe_session_id: session.id,
      status: "pending",
    });

    await recordPlatformCheckoutStarted(admin, {
      productType: "tournament",
      productEntityId: String(cap.id),
      userId: u.user.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentIdFromCheckoutSession(session),
      amountCents: feeCents,
      currency: "usd",
      title: `Tournament captain payment — ${String(t.title || "Tournament").trim() || "Tournament"}`,
      summary: null,
      metadata: {
        tournament_id: t.id,
        captain_id: cap.id,
        flow: "tournament_captain",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_create_checkout_session_error:", msg);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
