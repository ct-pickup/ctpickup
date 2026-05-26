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
import { addUserToRunBanterRoom, removeUserFromRunBanterRoom } from "@/lib/chat/runBanterRoom";
import { notifyFollowersWhenFollowedPlayerConfirmsRun } from "@/lib/pickup/notifyFollowersOnPickupConfirm";
import { sendPickupRsvpConfirmedPush } from "@/lib/pickup/pickupPushNotifications";
import {
  countAcceptedPickupRsvps,
  deletePendingWaitlistExpiringReminders,
  promoteNextWaitlistPlayer,
} from "@/lib/pickup/waitlist";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { pickupPlayerRefundEligibleNow } from "@/lib/pickup/runScheduling";
import { tryApplyReferralCreditToPickupJoin } from "@/lib/referral/pickupReferralCredit";
import {
  isMobileCheckoutReturn,
  pickupCheckoutCancelUrl,
  pickupCheckoutSuccessUrl,
} from "@/lib/pickup/stripeCheckoutUrls";

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
  checkout_return?: "mobile" | "app";
};

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banRes = await admin.from("profiles").select("is_banned").eq("id", user.id).maybeSingle();
  if (banRes.data?.is_banned === true) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  if (!body?.action || !body?.run_id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const mobileReturn = isMobileCheckoutReturn(body);

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
      const inviteRow = await admin
        .from("pickup_run_invites")
        .select("user_id")
        .eq("run_id", run.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!inviteRow.data) {
        eligible = false;
      } else {
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
    }

    if (!eligible) {
      return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
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

    const prev = existing.data?.status || null;
    const row = existing.data as
      | (typeof existing.data & {
          payment_intent_id?: string | null;
          refund_id?: string | null;
        })
      | null;
    const pi =
      row?.payment_intent_id != null && String(row.payment_intent_id).trim().length > 0
        ? String(row.payment_intent_id).trim()
        : null;
    const refundEligible =
      prev === "confirmed" && pi && !row?.refund_id && pickupPlayerRefundEligibleNow(run);

    if (refundEligible) {
      let stripe;
      try {
        stripe = getStripePickup();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("stripe_pickup_cancel_refund_config_error:", msg);
        return NextResponse.json({ error: "Stripe is not configured." }, { status: 500 });
      }
      try {
        const refund = await stripe.refunds.create({ payment_intent: pi });
        await admin.from("pickup_run_rsvps").upsert(
          {
            run_id: run.id,
            user_id: user.id,
            tier_at_time: prof.data?.tier || null,
            status: newStatus,
            refund_id: refund.id,
            waitlist_position: null,
            waitlist_offered_at: null,
            waitlist_expires_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "run_id,user_id" },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("stripe_pickup_player_cancel_refund_error:", msg);
        return NextResponse.json({ error: "Refund could not be processed. Try again or contact support." }, { status: 502 });
      }
    } else {
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
    }

    if (prev === "pending_confirm") {
      await deletePendingWaitlistExpiringReminders(admin, user.id, run.id);
    }

    await removeUserFromRunBanterRoom(admin, String(run.id), user.id);

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
    const inviteRow = await admin
      .from("pickup_run_invites")
      .select("user_id")
      .eq("run_id", run.id)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!inviteRow.data) {
      eligible = false;
    } else {
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
  }

  if (!eligible) {
    return NextResponse.json({ error: "Not eligible for this final RSVP." }, { status: 403 });
  }

  const existing = await admin
    .from("pickup_run_rsvps")
    .select("*")
    .eq("run_id", run.id)
    .eq("user_id", targetUserId)
    .maybeSingle();

  const reservedCount = await countAcceptedPickupRsvps(admin, String(run.id));
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
    if (existing.data?.status === "pending_confirm") {
      await deletePendingWaitlistExpiringReminders(admin, targetUserId, run.id);
    }
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
      await deletePendingWaitlistExpiringReminders(admin, targetUserId, run.id);
      return NextResponse.json({ error: "Waitlist offer expired." }, { status: 410 });
    }
  }

  const feeCents = Number(run.fee_cents || 0);

  let pickupCreditResult: Awaited<ReturnType<typeof tryApplyReferralCreditToPickupJoin>> = {
    applied: false,
  };
  if (feeCents > 0 && !payForFriend) {
    pickupCreditResult = await tryApplyReferralCreditToPickupJoin(admin, {
      payerUserId: user.id,
      targetUserId,
      runId: String(run.id),
      tierAtTime: targetProf.data?.tier || null,
      feeCents,
      previousRsvpStatus: existing.data?.status ?? null,
      hadPendingConfirm: existing.data?.status === "pending_confirm",
    });
    if (pickupCreditResult.applied && pickupCreditResult.kind === "free") {
      const prevRsvpStatus = existing.data?.status ?? null;
      if (prevRsvpStatus !== "confirmed") {
        await sendPickupRsvpConfirmedPush(admin, {
          userId: targetUserId,
          runId: String(run.id),
          runTitle: String(run.title || ""),
        });
      }
      return NextResponse.json({
        ok: true,
        status: "confirmed",
        pickup_credit_applied: true,
        message: pickupCreditResult.message,
      });
    }
  }

  if (feeCents <= 0) {
    const prevRsvpStatus = existing.data?.status ?? null;
    // #region agent log
    fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75987",
      },
      body: JSON.stringify({
        sessionId: "b75987",
        hypothesisId: "H1-H4",
        location: "app/api/pickup/rsvp/route.ts:free_fee0_before_upsert",
        message: "feeCents<=0 RSVP path entering; log capacity and previous status",
        data: {
          runId: String(run.id),
          userId: String(targetUserId),
          feeCents,
          capacity,
          reservedCount,
          hasSlot,
          prevRsvpStatus,
          existingStatus: existing.data?.status ?? null,
          runStatus: String(run.status || ""),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    const upsertPayload = {
      run_id: run.id,
      user_id: targetUserId,
      tier_at_time: targetProf.data?.tier || null,
      status: "confirmed" as const,
      waitlist_position: null,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      updated_at: new Date().toISOString(),
    };
    const upsertOptions = { onConflict: "run_id,user_id" as const };

    console.log({
      tag: "pickup-rsvp",
      message: "free_rsvp_upsert_payload",
      data: { payload: upsertPayload, options: upsertOptions },
    });

    const upsertRes = await admin.from("pickup_run_rsvps").upsert(upsertPayload, upsertOptions);

    if (upsertRes.error) {
      console.error({
        tag: "pickup-rsvp",
        message: "free_rsvp_upsert_failed",
        data: {
          payload: upsertPayload,
          options: upsertOptions,
          error: upsertRes.error,
        },
      });
      return NextResponse.json(
        { error: "Could not save RSVP. Please try again or contact support." },
        { status: 500 },
      );
    }

    // #region agent log
    const savedRes = await admin
      .from("pickup_run_rsvps")
      .select("status,waitlist_position")
      .eq("run_id", run.id)
      .eq("user_id", targetUserId)
      .maybeSingle();
    const confirmedAfter = await countAcceptedPickupRsvps(admin, String(run.id));
    fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75987",
      },
      body: JSON.stringify({
        sessionId: "b75987",
        hypothesisId: "H1",
        location: "app/api/pickup/rsvp/route.ts:free_fee0_after_upsert",
        message: "after upsert: log upsert error + saved status + confirmed count",
        data: {
          runId: String(run.id),
          userId: String(targetUserId),
          upsertOk: !upsertRes?.error,
          upsertError: (upsertRes?.error as any)?.message ?? null,
          savedStatus: savedRes.data?.status ?? null,
          savedWaitlistPosition: savedRes.data?.waitlist_position ?? null,
          confirmedAfter,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (existing.data?.status === "pending_confirm") {
      await deletePendingWaitlistExpiringReminders(admin, targetUserId, run.id);
    }
    await ensurePickupRunInviteLink(admin, run.id, targetUserId);
    await addUserToRunBanterRoom(admin, String(run.id), targetUserId);
    if (prevRsvpStatus !== "confirmed") {
      // #region agent log
      fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "b75987",
        },
        body: JSON.stringify({
          sessionId: "b75987",
          hypothesisId: "H2",
          location: "app/api/pickup/rsvp/route.ts:free_fee0_before_push",
          message: "log savedStatus and count immediately before sending confirmed push",
          data: {
            runId: String(run.id),
            userId: String(targetUserId),
            prevRsvpStatus,
            savedStatus: savedRes.data?.status ?? null,
            confirmedAfter,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      await sendPickupRsvpConfirmedPush(admin, {
        userId: targetUserId,
        runId: String(run.id),
        runTitle: String(run.title || ""),
      });
      try {
        await notifyFollowersWhenFollowedPlayerConfirmsRun(admin, {
          runId: String(run.id),
          playerId: String(targetUserId),
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("pickup_rsvp_follower_join_notify_error:", msg);
      }
    }
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

  let unitAmount = Number.isFinite(feeCents) ? Math.round(feeCents) : feeCents;
  if (pickupCreditResult.applied && pickupCreditResult.kind === "discount") {
    unitAmount = pickupCreditResult.discountedFeeCents;
    pickupMeta.credit_id = pickupCreditResult.creditId;
  }

  let session;
  try {
    const currency = String(run.currency || "usd").trim().toLowerCase() || "usd";
    const successUrl = pickupCheckoutSuccessUrl(baseUrl, mobileReturn);
    const cancelUrl = pickupCheckoutCancelUrl(baseUrl, mobileReturn);

    const snapshot = {
      event: "stripe_checkout_create_attempt" as const,
      route: "app/api/pickup/rsvp/route.ts" as const,
      baseUrl,
      success_url: successUrl,
      cancel_url: cancelUrl,
      mobile_return: mobileReturn,
      mode: "payment" as const,
      currency,
      unit_amount: unitAmount,
      customer_email_present: !!(user.email && String(user.email).trim()),
      metadata_keys: Object.keys(pickupMeta),
    };

    console.log({ tag: "pickup-rsvp", message: "stripe_checkout_create_attempt", data: snapshot });

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

  console.log({
    tag: "pickup-rsvp",
    message: "stripe_checkout_created",
    data: { flow: "pickup_rsvp", checkout_session_id: session.id, run_id: run.id },
  });

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

  if (existing.data?.status === "pending_confirm") {
    await deletePendingWaitlistExpiringReminders(admin, targetUserId, run.id);
  }

  await recordPlatformCheckoutStarted(admin, {
    productType: "pickup",
    productEntityId: String(run.id),
    userId: user.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentIdFromCheckoutSession(session),
    amountCents: unitAmount,
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
