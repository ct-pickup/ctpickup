import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: (process.env.STRIPE_API_VERSION as any) || "2026-02-25",
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin = createClient(supabaseUrl, serviceKey);
const anon = createClient(supabaseUrl, anonKey);

async function expireIfOverdue(captain: any) {
  if (captain.status !== "payment_pending") return captain;
  if (!captain.payment_due_at) return captain;
  if (new Date(captain.payment_due_at).getTime() > Date.now()) return captain;

  await admin
    .from("tournament_captains")
    .update({ status: "released_expired" })
    .eq("id", captain.id);

  return { ...captain, status: "released_expired" };
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
    if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

    const { data: u, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

    const waiverOk = await userHasAcceptedCurrentWaiver(u.user.id);
    if (!waiverOk) {
      return NextResponse.json({ error: "waiver_required" }, { status: 403 });
    }

    const { data: t } = await admin
      .from("tournaments")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!t) return NextResponse.json({ error: "no_active_tournament" }, { status: 404 });

    const { data: captain } = await admin
      .from("tournament_captains")
      .select("*")
      .eq("tournament_id", t.id)
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (!captain) return NextResponse.json({ error: "no_captain_claim" }, { status: 409 });

    const cap = await expireIfOverdue(captain);
    if (cap.status === "released_expired") {
      return NextResponse.json({ error: "claim_expired_reclaim" }, { status: 409 });
    }

    if (!cap.captain_verified) {
      return NextResponse.json({ error: "captain_not_verified" }, { status: 409 });
    }

    if (cap.status === "confirmed") {
      return NextResponse.json({ error: "already_confirmed" }, { status: 409 });
    }

    // Start payment window now (36 hours)
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 25000,
            product_data: {
              name: "CT Pickup Tournament — Captain Payment",
              description: "5 players × $50. No refunds within 48 hours of kickoff.",
            },
          },
        },
      ],
      success_url: `${origin}/tournament?paid=1`,
      cancel_url: `${origin}/tournament?canceled=1`,
      customer_email: u.user.email || undefined,
      client_reference_id: cap.id,
      metadata: {
        tournament_id: String(t.id),
        captain_id: String(cap.id),
        user_id: String(u.user.id),
        players_count: "5",
      },
    });

    await admin.from("tournament_payments").insert({
      tournament_id: t.id,
      captain_id: cap.id,
      method: "stripe",
      amount_cents: 25000,
      players_count: 5,
      stripe_session_id: session.id,
      status: "pending",
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: "server_error", details: String(e?.message || e) }, { status: 500 });
  }
}
