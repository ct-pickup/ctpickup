import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getSupabaseAdmin, getStripePickup } from "@/lib/server/runtimeClients";
import { cancelPickupRunAndSettle } from "@/lib/payments/runCancelSettlement";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Host cancel (or an admin cancelling someone else's session); settlement rules live in cancelPickupRunAndSettle. */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id, reason } = await req.json() as { run_id: string; reason?: string };
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, start_at, status, canceled_at")
    .eq("id", run_id)
    .maybeSingle();

  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (run.created_by !== user.id && !prof?.is_admin) {
    return NextResponse.json({ error: "Only the host can cancel this session." }, { status: 403 });
  }

  let stripe: Stripe | null = null;
  const out = await cancelPickupRunAndSettle(
    admin,
    () => {
      if (!stripe) stripe = getStripePickup();
      return stripe;
    },
    {
      run,
      initiator: run.created_by === user.id ? "host" : "admin",
      reason: reason ?? "Host cancelled",
      routeTag: "sessions/cancel",
    },
  );
  return NextResponse.json(out.body, { status: out.status });
}
