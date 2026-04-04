import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { run_id, reason } = await req.json();

  await supabaseAdmin
    .from("pickup_runs")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run_id);

  const rsvpsRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("user_id,payment_intent_id,paid_at,refund_id,status")
    .eq("run_id", run_id);

  const rsvps = rsvpsRes.data || [];

  const refunded: string[] = [];
  const failed: { user_id: string; error: string }[] = [];

  for (const r of rsvps) {
    try {
      if (r.paid_at && r.payment_intent_id && !r.refund_id) {
        const refund = await stripe.refunds.create({
          payment_intent: String(r.payment_intent_id),
        });

        await supabaseAdmin
          .from("pickup_run_rsvps")
          .update({
            refund_id: refund.id,
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("run_id", run_id)
          .eq("user_id", r.user_id);

        refunded.push(r.user_id);
      } else {
        await supabaseAdmin
          .from("pickup_run_rsvps")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("run_id", run_id)
          .eq("user_id", r.user_id);
      }
    } catch (e: any) {
      failed.push({ user_id: r.user_id, error: e?.message || "refund failed" });
    }
  }

  return NextResponse.json({ ok: true, refunded, failed });
}
