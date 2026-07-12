import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { run_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { run_id } = body;
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const userId = user.id;

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, created_by, fee_cents, start_at, status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  if (run.status === "canceled" || run.status === "completed") {
    return NextResponse.json({ error: "Session has already ended." }, { status: 409 });
  }

  if (run.created_by === userId) {
    return NextResponse.json(
      { error: "Use the cancel endpoint to cancel your own session." },
      { status: 400 },
    );
  }

  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status, paid_at")
    .eq("run_id", run_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!rsvp || rsvp.status !== "confirmed") {
    return NextResponse.json({ error: "No active RSVP found." }, { status: 404 });
  }

  const now = new Date();
  const startAt = new Date(run.start_at);
  const msUntilStart = startAt.getTime() - now.getTime();
  const earlyEnough = msUntilStart > 24 * 60 * 60 * 1000;

  const nowIso = now.toISOString();

  await admin
    .from("pickup_run_rsvps")
    .update({ status: "canceled", updated_at: nowIso })
    .eq("run_id", run_id)
    .eq("user_id", userId);

  const hasFee = (run.fee_cents ?? 0) > 0;
  const hasPaid = !!rsvp.paid_at;

  if (earlyEnough && hasFee && hasPaid) {
    const { data: payment } = await admin
      .from("platform_payments")
      .select("amount_cents")
      .eq("product_entity_id", run_id)
      .eq("user_id", userId)
      .eq("lifecycle_status", "captured")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const creditAmountCents = (payment?.amount_cents ?? run.fee_cents ?? 0) as number;
    const expiresAt = new Date(now.getTime() + THREE_MONTHS_MS).toISOString();

    await admin.from("pickup_credits").insert({
      user_id: userId,
      amount_cents: creditAmountCents,
      discount_pct: null,
      reason: "cancellation",
      expires_at: expiresAt,
      cancelled_run_id: run_id,
    });

    const creditDollars = (creditAmountCents / 100).toFixed(2);

    await sendPushToUsers(admin, [userId], {
      title: "You left the session",
      body: `You left ${run.title}. A credit of $${creditDollars} has been added to your account.`,
      data: { kind: "session_left", run_id },
    });

    return NextResponse.json({ ok: true, credit_issued: true, amount_cents: creditAmountCents });
  }

  const pushBody =
    hasFee && hasPaid
      ? `You left ${run.title}. No refund applies within 24 hours of kickoff.`
      : `You have left ${run.title}.`;

  await sendPushToUsers(admin, [userId], {
    title: "You left the session",
    body: pushBody,
    data: { kind: "session_left", run_id },
  });

  return NextResponse.json({ ok: true, credit_issued: false });
}
