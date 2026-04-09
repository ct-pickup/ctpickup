import { NextResponse } from "next/server";
import { paymentIntentIdFromCheckoutSession } from "@/lib/payments/stripeSessionIds";
import { recordPlatformCheckoutStarted } from "@/lib/payments/recordCheckoutStarted";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { ESPORTS_ENTRY_FEE_CENTS } from "@/lib/esports/constants";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const server = await supabaseServer();
    const user = await getAuthUserSafe(server);
    if (!user) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
    }

    const body = await req.json();
    const tournamentId = String(body?.tournament_id || "").trim();
    if (!tournamentId) {
      return NextResponse.json({ error: "Missing tournament_id." }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    const { data: tournament, error: tErr } = await admin
      .from("esports_tournaments")
      .select("id,title,status")
      .eq("id", tournamentId)
      .in("status", ["upcoming", "active"])
      .maybeSingle();

    if (tErr || !tournament) {
      return NextResponse.json({ error: "Tournament not open for registration." }, { status: 404 });
    }

    const { data: reg, error: rErr } = await admin
      .from("esports_tournament_registrations")
      .select("id,payment_status,stripe_checkout_session_id")
      .eq("user_id", user.id)
      .eq("tournament_id", tournamentId)
      .maybeSingle();

    if (rErr || !reg) {
      return NextResponse.json(
        { error: "Complete legal consent on the registration page before paying." },
        { status: 403 },
      );
    }

    if (reg.payment_status === "paid") {
      return NextResponse.json({ error: "Payment already recorded for this tournament." }, { status: 409 });
    }

    let stripe;
    try {
      stripe = getStripePickup();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("stripe_esports_checkout_config:", msg);
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 500 });
    }

    const baseUrl = requestSiteUrlFromRequest(req);
    const title = String(tournament.title || "Esports tournament").trim() || "Esports tournament";

    const esportsMeta = {
      kind: "esports" as const,
      registration_id: String(reg.id),
      tournament_id: String(tournamentId),
      user_id: String(user.id),
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: user.email || undefined,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: ESPORTS_ENTRY_FEE_CENTS,
              product_data: {
                name: `CT Pickup Esports entry — ${title}`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/esports/tournaments/${tournamentId}/register?paid=1`,
        cancel_url: `${baseUrl}/esports/tournaments/${tournamentId}/register?canceled=1`,
        metadata: { ...esportsMeta },
        payment_intent_data: {
          metadata: { ...esportsMeta },
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("stripe_esports_checkout_error:", msg);
      return NextResponse.json({ error: "Checkout could not be created." }, { status: 500 });
    }

    const now = new Date().toISOString();
    const { error: upErr } = await admin
      .from("esports_tournament_registrations")
      .update({
        stripe_checkout_session_id: session.id,
        payment_status: "checkout_started",
        stripe_payment_intent_id: paymentIntentIdFromCheckoutSession(session),
        updated_at: now,
      })
      .eq("id", reg.id)
      .eq("user_id", user.id);

    if (upErr) {
      console.error("esports registration checkout update:", upErr.message);
      return NextResponse.json({ error: "Could not link checkout to your registration." }, { status: 500 });
    }

    await recordPlatformCheckoutStarted(admin, {
      productType: "sports",
      productEntityId: String(reg.id),
      userId: user.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentIdFromCheckoutSession(session),
      amountCents: ESPORTS_ENTRY_FEE_CENTS,
      currency: "usd",
      title: `Esports entry — ${title}`,
      summary: `Tournament ${tournamentId}`,
      metadata: { flow: "esports_entry", tournament_id: tournamentId, registration_id: reg.id },
    });

    return NextResponse.json({ ok: true, checkout_url: session.url });
  } catch (e) {
    console.error("esports checkout route:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
