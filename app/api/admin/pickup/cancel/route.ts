import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { cancelPickupRunAndSettle } from "@/lib/payments/runCancelSettlement";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { run_id, reason } = await req.json();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await supabaseAdmin
    .from("pickup_runs")
    .select("id, title, fee_cents, start_at, status, canceled_at")
    .eq("id", run_id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  let stripe: Stripe | null = null;
  const out = await cancelPickupRunAndSettle(
    supabaseAdmin,
    () => {
      if (!stripe) stripe = getStripePickup();
      return stripe;
    },
    { run, initiator: "admin", reason: reason || null, routeTag: "admin/pickup/cancel" },
  );
  return NextResponse.json(out.body, { status: out.status });
}
