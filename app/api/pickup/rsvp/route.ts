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

type Body = { action: "join" | "decline"; run_id: string };

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Body;
  if (!body?.action || !body?.run_id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const runRes = await admin.from("pickup_runs").select("*").eq("id", body.run_id).maybeSingle();
  const run = runRes.data;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // Final RSVP only opens after admin finalizes slot
  if (run.status !== "active" || !run.start_at || !run.final_slot_id) {
    return NextResponse.json({ error: "Final RSVP not open yet." }, { status: 403 });
  }

  const prof = await admin
    .from("profiles")
    .select("approved, tier_rank, tier")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof.data?.approved) {
    return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
  }

  // Must have availability available for final slot
  const myAvail = await admin
    .from("pickup_run_availability")
    .select("state, slot_id")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const eligible =
    myAvail.data?.state === "available" && myAvail.data?.slot_id === run.final_slot_id;

  if (!eligible) {
    return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
  }

  // Cancellation cutoff applies only once start_at exists
  const now = Date.now();
  const deadline = run.cancellation_deadline ? new Date(run.cancellation_deadline).getTime() : null;
  if (deadline && now > deadline) {
    return NextResponse.json({ error: "Deadline passed." }, { status: 403 });
  }

  const existing = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (body.action === "decline") {
    if (existing.data?.status === "pending_payment") {
      return NextResponse.json({ error: "Payment is pending. Contact admin." }, { status: 409 });
    }

    const newStatus =
      existing.data?.status && existing.data.status !== "declined" ? "canceled" : "declined";

    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: newStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );

    return NextResponse.json({ ok: true, status: newStatus });
  }

  // JOIN
  const confirmedCountRes = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("status", "confirmed");

  const confirmedCount = confirmedCountRes.count || 0;
  const capacity = Number(run.capacity || 0);
  const hasSlot = confirmedCount < capacity;

  if (!hasSlot) {
    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: "standby",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );
    return NextResponse.json({ ok: true, status: "standby" });
  }

  const feeCents = Number(run.fee_cents || 0);
  if (feeCents <= 0) {
    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: user.id,
        tier_at_time: prof.data?.tier || null,
        status: "confirmed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" }
    );
    return NextResponse.json({ ok: true, status: "confirmed" });
  }

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

  await admin.from("pickup_run_rsvps").upsert(
    {
      run_id: run.id,
      user_id: user.id,
      tier_at_time: prof.data?.tier || null,
      status: "pending_payment",
      checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id" }
  );

  return NextResponse.json({ ok: true, checkout_url: session.url });
}