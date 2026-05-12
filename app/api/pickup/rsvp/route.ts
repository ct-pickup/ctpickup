import { NextResponse } from "next/server";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import { lookupPickupPlayerByUsernameOrEmail } from "@/lib/pickup/lookupPlayerByIdentifier";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { assertPickupStandingAllowsParticipation } from "@/lib/pickup/standing/participationGate";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { PICKUP_FIELD_FEE_STRIPE_DESCRIPTION } from "@/lib/fees/refundPolicyCopy";
import { paymentIntentIdFromCheckoutSession } from "@/lib/payments/stripeSessionIds";
import { recordPlatformCheckoutStarted } from "@/lib/payments/recordCheckoutStarted";
import { getStripePickup, getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type Body = {
  action: "join" | "decline";
  run_id: string;
  friend_user_id?: string;
  friend_identifier?: string;
};

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Body;
  if (!body?.action || !body?.run_id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (body.action === "decline") {
    const waiverOk = await userHasAcceptedCurrentWaiver(user.id);
    if (!waiverOk) {
      return NextResponse.json({ error: "waiver_required" }, { status: 403 });
    }

    const standingGate = await assertPickupStandingAllowsParticipation(admin, user.id);
    if (!standingGate.ok) {
      return NextResponse.json(
        { error: standingGate.code, detail: standingGate.detail },
        { status: 403 },
      );
    }

    const runRes = await admin.from("pickup_runs").select("*").eq("id", body.run_id).maybeSingle();
    const run = runRes.data;
    if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

    const publicRun = isPublicPickupRunType(run.run_type);

    if (publicRun) {
      const st = String(run.status || "").trim().toLowerCase();
      if (st === "canceled" || st === "cancelled") {
        return NextResponse.json({ error: "This run was canceled." }, { status: 403 });
      }
      const completed =
        (run as { is_completed?: boolean | null }).is_completed === true || st === "completed";
      if (completed) {
        return NextResponse.json({ error: "This run is already completed." }, { status: 403 });
      }
    } else {
      if (run.status !== "active" || !run.start_at || !run.final_slot_id) {
        return NextResponse.json({ error: "Final RSVP not open yet." }, { status: 403 });
      }
    }

    const prof = await admin
      .from("profiles")
      .select("approved, tier_rank, tier")
      .eq("id", user.id)
      .maybeSingle();

    if (!prof.data?.approved) {
      return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
    }

    let eligible = publicRun;
    if (!publicRun) {
      const myAvail = await admin
        .from("pickup_run_availability")
        .select("id")
        .eq("run_id", run.id)
        .eq("user_id", user.id)
        .eq("state", "available")
        .eq("slot_id", run.final_slot_id)
        .limit(1)
        .maybeSingle();

      eligible = !!myAvail.data?.id;
    }

    if (!eligible) {
      return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
    }

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
        waitlist_position: null,
        waitlist_offered_at: null,
        waitlist_expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" },
    );

    const prev = existing.data?.status || null;
    if (prev === "confirmed" || prev === "pending_confirm") {
      await promoteNextWaitlistPlayer(admin, String(run.id), {
        requestedBy: user.id,
        reason: prev === "confirmed" ? "player_cancel" : "player_decline_offer",
      });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  }

  // JOIN
  const rawFriendId = typeof body.friend_user_id === "string" ? body.friend_user_id.trim() : "";
  const rawFriendIdent =
    typeof body.friend_identifier === "string" ? body.friend_identifier.trim() : "";

  let targetUserId = user.id;
  let payForFriend = false;

  if (rawFriendId || rawFriendIdent) {
    let resolvedId: string | null = null;
    if (rawFriendId && UUID_RE.test(rawFriendId)) {
      const exists = await admin.from("profiles").select("id").eq("id", rawFriendId).maybeSingle();
      if (!exists.data?.id) {
        return NextResponse.json({ error: "Player not found." }, { status: 404 });
      }
      resolvedId = rawFriendId;
    } else {
      const lookupRaw = rawFriendIdent || rawFriendId;
      const found = await lookupPickupPlayerByUsernameOrEmail(admin, lookupRaw);
      if (!found) {
        return NextResponse.json({ error: "Player not found." }, { status: 404 });
      }
      resolvedId = found.user_id;
    }

    if (resolvedId === user.id) {
      return NextResponse.json(
        { error: "Use the normal join flow for your own account." },
        { status: 400 },
      );
    }
    targetUserId = resolvedId;
    payForFriend = true;
  }

  const waiverPayer = await userHasAcceptedCurrentWaiver(user.id);
  if (!waiverPayer) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const standingPayer = await assertPickupStandingAllowsParticipation(admin, user.id);
  if (!standingPayer.ok) {
    return NextResponse.json(
      { error: standingPayer.code, detail: standingPayer.detail },
      { status: 403 },
    );
  }

  if (payForFriend) {
    const waiverFriend = await userHasAcceptedCurrentWaiver(targetUserId);
    if (!waiverFriend) {
      return NextResponse.json(
        { error: "friend_waiver_required", detail: "That player must accept the waiver before you can pay for them." },
        { status: 403 },
      );
    }
    const standingFriend = await assertPickupStandingAllowsParticipation(admin, targetUserId);
    if (!standingFriend.ok) {
      return NextResponse.json(
        { error: standingFriend.code, detail: standingFriend.detail },
        { status: 403 },
      );
    }
  }

  const runRes = await admin.from("pickup_runs").select("*").eq("id", body.run_id).maybeSingle();
  const run = runRes.data;
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // Once a run is locked or marked in_progress, no new RSVPs (joins) are
  // accepted. This is shared by public and select runs so a tap of
  // "Begin Pickup Now" closes joining for everyone.
  {
    const st = String(run.status || "").trim().toLowerCase();
    const lockedAt = (run as { locked_at?: string | null }).locked_at;
    if (st === "in_progress" || (typeof lockedAt === "string" && lockedAt.trim().length > 0)) {
      return NextResponse.json({ error: "This run has already started." }, { status: 403 });
    }
  }

  const publicRun = isPublicPickupRunType(run.run_type);

  if (publicRun) {
    const st = String(run.status || "").trim().toLowerCase();
    if (st === "canceled" || st === "cancelled") {
      return NextResponse.json({ error: "This run was canceled." }, { status: 403 });
    }
    const completed =
      (run as { is_completed?: boolean | null }).is_completed === true || st === "completed";
    if (completed) {
      return NextResponse.json({ error: "This run is already completed." }, { status: 403 });
    }
  } else {
    if (run.status !== "active" || !run.start_at || !run.final_slot_id) {
      return NextResponse.json({ error: "Final RSVP not open yet." }, { status: 403 });
    }
  }

  const requesterProf = await admin
    .from("profiles")
    .select("approved, tier_rank, tier")
    .eq("id", user.id)
    .maybeSingle();

  if (!requesterProf.data?.approved) {
    return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
  }

  const targetProf =
    targetUserId === user.id
      ? requesterProf
      : await admin
          .from("profiles")
          .select("approved, tier_rank, tier")
          .eq("id", targetUserId)
          .maybeSingle();

  if (!targetProf.data?.approved) {
    return NextResponse.json(
      { error: payForFriend ? "Friend account pending approval." : "Account pending approval." },
      { status: 403 },
    );
  }

  let eligible = publicRun;
  if (!publicRun) {
    const myAvail = await admin
      .from("pickup_run_availability")
      .select("id")
      .eq("run_id", run.id)
      .eq("user_id", targetUserId)
      .eq("state", "available")
      .eq("slot_id", run.final_slot_id)
      .limit(1)
      .maybeSingle();

    eligible = !!myAvail.data?.id;
  }

  if (!eligible) {
    return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
  }

  const now = Date.now();
  const deadline = run.cancellation_deadline ? new Date(run.cancellation_deadline).getTime() : null;
  if (deadline && now > deadline) {
    return NextResponse.json({ error: "Deadline passed." }, { status: 403 });
  }

  const existing = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", targetUserId)
    .maybeSingle();

  const reservedCountRes = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("status", "confirmed");

  const reservedCount = reservedCountRes.count || 0;
  const capacity = Number(run.capacity || 0);
  const hasSlot = reservedCount < capacity;

  if (!hasSlot) {
    const maxPosRes = await admin
      .from("pickup_run_rsvps")
      .select("waitlist_position")
      .eq("run_id", run.id)
      .eq("status", "waitlist")
      .order("waitlist_position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const maxPos =
      maxPosRes.data?.waitlist_position === null || maxPosRes.data?.waitlist_position === undefined
        ? 0
        : Number(maxPosRes.data?.waitlist_position);

    const nextPos = (Number.isFinite(maxPos) ? maxPos : 0) + 1;

    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: targetUserId,
        tier_at_time: targetProf.data?.tier || null,
        status: "waitlist",
        waitlist_position: nextPos,
        waitlist_offered_at: null,
        waitlist_expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" },
    );
    await ensurePickupRunInviteLink(admin, run.id, targetUserId);
    return NextResponse.json({ ok: true, status: "waitlist", waitlist_position: nextPos });
  }

  if (existing.data?.status === "pending_confirm") {
    const expiresAt = existing.data?.waitlist_expires_at
      ? new Date(existing.data.waitlist_expires_at).getTime()
      : null;
    if (expiresAt && Date.now() > expiresAt) {
      await admin
        .from("pickup_run_rsvps")
        .update({
          status: "declined",
          waitlist_offered_at: null,
          waitlist_expires_at: null,
          waitlist_position: null,
          updated_at: new Date().toISOString(),
        })
        .eq("run_id", run.id)
        .eq("user_id", targetUserId);
      return NextResponse.json({ error: "Waitlist offer expired." }, { status: 410 });
    }
  }

  const feeCents = Number(run.fee_cents || 0);
  if (feeCents <= 0) {
    await admin.from("pickup_run_rsvps").upsert(
      {
        run_id: run.id,
        user_id: targetUserId,
        tier_at_time: targetProf.data?.tier || null,
        status: "confirmed",
        waitlist_position: null,
        waitlist_offered_at: null,
        waitlist_expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id" },
    );
    await ensurePickupRunInviteLink(admin, run.id, targetUserId);
    return NextResponse.json({ ok: true, status: "confirmed" });
  }

  let stripe;
  try {
    stripe = getStripePickup();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_pickup_rsvp_config_error:", msg);
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  const baseUrl = requestSiteUrlFromRequest(req);

  const pickupMeta: Record<string, string> = {
    kind: "pickup",
    run_id: String(run.id),
    user_id: String(targetUserId),
  };
  if (payForFriend) {
    pickupMeta.paid_by_user_id = String(user.id);
  }

  let session;
  try {
    const currency = String(run.currency || "usd").trim().toLowerCase() || "usd";
    const unitAmount = Number.isFinite(feeCents) ? Math.round(feeCents) : feeCents;
    const successUrl = `${baseUrl}/pickup?paid=1`;
    const cancelUrl = `${baseUrl}/pickup?canceled=1`;

    const snapshot = {
      event: "stripe_checkout_create_attempt" as const,
      route: "app/api/pickup/rsvp/route.ts" as const,
      baseUrl,
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: "payment" as const,
      currency,
      unit_amount: unitAmount,
      customer_email_present: !!(user.email && String(user.email).trim()),
      metadata_keys: Object.keys(pickupMeta),
    };

    console.log(JSON.stringify(snapshot));

    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `CT Pickup Field Fee`,
              description: PICKUP_FIELD_FEE_STRIPE_DESCRIPTION,
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: pickupMeta,
      payment_intent_data: {
        metadata: pickupMeta,
      },
    });
  } catch (e: unknown) {
    const err = e as {
      name?: unknown;
      message?: unknown;
      type?: unknown;
      code?: unknown;
      param?: unknown;
      statusCode?: unknown;
      requestId?: unknown;
    };
    console.error(
      "stripe_pickup_rsvp_checkout_error:",
      JSON.stringify({
        event: "stripe_checkout_error",
        route: "app/api/pickup/rsvp/route.ts",
        name: err?.name ?? null,
        message: err?.message || (e instanceof Error ? e.message : String(e)),
        stripe_type: err?.type ?? null,
        stripe_code: err?.code ?? null,
        stripe_param: err?.param ?? null,
        stripe_status_code: err?.statusCode ?? null,
        stripe_request_id: err?.requestId ?? null,
        reached_stripe: true,
        request: {
          baseUrl,
          success_url: `${baseUrl}/pickup?paid=1`,
          cancel_url: `${baseUrl}/pickup?canceled=1`,
          mode: "payment",
          currency: String(run.currency || "usd").trim().toLowerCase() || "usd",
          unit_amount: Number.isFinite(feeCents) ? Math.round(feeCents) : feeCents,
          customer_email_present: !!(user.email && String(user.email).trim()),
          metadata_keys: Object.keys(pickupMeta),
        },
      }),
    );
    return NextResponse.json({ error: "Checkout could not be created." }, { status: 500 });
  }

  console.log(
    JSON.stringify({
      stripe_checkout: true,
      flow: "pickup_rsvp",
      checkout_session_id: session.id,
      run_id: run.id,
    }),
  );

  await admin.from("pickup_run_rsvps").upsert(
    {
      run_id: run.id,
      user_id: targetUserId,
      tier_at_time: targetProf.data?.tier || null,
      status: "pending_payment",
      checkout_session_id: session.id,
      waitlist_position: null,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id" },
  );

  await recordPlatformCheckoutStarted(admin, {
    productType: "pickup",
    productEntityId: String(run.id),
    userId: user.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentIdFromCheckoutSession(session),
    amountCents: feeCents,
    currency: String(run.currency || "usd"),
    title: `Pickup field fee — ${String(run.title || "Run").trim() || "Run"}`,
    summary: null,
    metadata: {
      run_id: run.id,
      flow: "pickup_rsvp",
      ...(payForFriend ? { paid_for_user_id: targetUserId } : {}),
    },
  });

  await ensurePickupRunInviteLink(admin, run.id, targetUserId);

  return NextResponse.json({ ok: true, checkout_url: session.url });
}
