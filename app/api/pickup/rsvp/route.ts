import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { tiersForPhase, type Tier } from "@/lib/pickup/tiers";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

type Body = { action: "join" | "decline" };

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Body;
  if (!body?.action) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const profRes = await supabaseAdmin
    .from("profiles")
    .select("tier, approved, full_name, instagram")
    .eq("id", user.id)
    .maybeSingle();

  const tier = (profRes.data?.tier as Tier) || "TPUBLIC";
  const approved = !!profRes.data?.approved;

  if (!approved) {
    return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
  }

  // upcoming run
  const runRes = await supabaseAdmin
    .from("pickup_runs")
    .select("*")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  const run = runRes.data?.[0];
  if (!run) return NextResponse.json({ error: "No run available." }, { status: 404 });

  const now = Date.now();
  const deadline = run.cancellation_deadline ? new Date(run.cancellation_deadline).getTime() : null;

  // After cancellation deadline: no new joins / no cancels
  if (deadline && now > deadline) {
    return NextResponse.json({ error: "Deadline passed." }, { status: 403 });
  }

  const invitedTiers = tiersForPhase(run.run_type, Number(run.invite_phase || 0));
  const invitedNow = invitedTiers.includes(tier);

  if (!invitedNow) {
    return NextResponse.json({ error: "Not invited yet." }, { status: 403 });
  }

  // get current RSVP if exists
  const existing = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", user.id)
    .maybeSingle();

  // decline
  if (body.action === "decline") {
    if (existing.data?.status === "pending_payment") {
      return NextResponse.json({ error: "Payment is pending. Contact admin." }, { status: 409 });
    }

    await supabaseAdmin
      .from("pickup_run_rsvps")
      .upsert({
        run_id: run.id,
        user_id: user.id,
        tier_at_time: tier,
        status: "declined",
        updated_at: new Date().toISOString(),
      }, { onConflict: "run_id,user_id" });

    return NextResponse.json({ ok: true, status: "declined" });
  }

  // JOIN
  const confirmedCountRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("status", "confirmed");

  const confirmedCount = confirmedCountRes.count || 0;
  const capacity = Number(run.capacity || 0);
  const hasSlot = confirmedCount < capacity;

  if (!hasSlot) {
    await supabaseAdmin
      .from("pickup_run_rsvps")
      .upsert({
        run_id: run.id,
        user_id: user.id,
        tier_at_time: tier,
        status: "standby",
        updated_at: new Date().toISOString(),
      }, { onConflict: "run_id,user_id" });

    return NextResponse.json({ ok: true, status: "standby" });
  }

  const feeCents = Number(run.fee_cents || 0);

  // Free run: confirm immediately
  if (feeCents <= 0) {
    await supabaseAdmin
      .from("pickup_run_rsvps")
      .upsert({
        run_id: run.id,
        user_id: user.id,
        tier_at_time: tier,
        status: "confirmed",
        updated_at: new Date().toISOString(),
      }, { onConflict: "run_id,user_id" });

    return NextResponse.json({ ok: true, status: "confirmed" });
  }

  // Paid run: require Stripe checkout
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

  await supabaseAdmin
    .from("pickup_run_rsvps")
    .upsert({
      run_id: run.id,
      user_id: user.id,
      tier_at_time: tier,
      status: "pending_payment",
      checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "run_id,user_id" });

  return NextResponse.json({ ok: true, checkout_url: session.url });
}
