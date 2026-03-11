import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const run_id = String(body.run_id || "");
  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  const run = runRes.data;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const rsvp = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!rsvp.data || rsvp.data.status !== "pending_payment") {
    return NextResponse.json({ error: "No pending payment for this run." }, { status: 409 });
  }

  const feeCents = Number(run.fee_cents || 0);
  if (feeCents <= 0) return NextResponse.json({ error: "This run is free." }, { status: 409 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: user.email || undefined,
    line_items: [
      {
        price_data: {
          currency: run.currency || "usd",
          unit_amount: feeCents,
          product_data: { name: `CT Pickup Field Fee` },
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/pickup?paid=1`,
    cancel_url: `${baseUrl}/pickup?canceled=1`,
    metadata: {
      kind: "pickup",
      run_id: String(run.id),
      user_id: String(user.id),
    },
  });

  await admin
    .from("pickup_run_rsvps")
    .update({
      checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", run.id)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true, url: session.url });
}