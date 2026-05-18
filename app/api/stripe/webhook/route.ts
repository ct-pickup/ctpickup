import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePickupRunInviteLink } from "@/lib/pickup/ensureRunInviteLink";
import { addUserToRunBanterRoom } from "@/lib/chat/runBanterRoom";
import { ensureTournamentTeamRoom } from "@/lib/chat/tournamentTeamRoom";
import {
  findPlatformPaymentIdByPaymentIntent,
  findPlatformPaymentIdBySession,
  logStripeWebhookEvent,
  patchPlatformPaymentByPaymentIntentId,
  patchPlatformPaymentBySessionId,
} from "@/lib/payments/webhookPersistence";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import { notifyFollowersWhenFollowedPlayerConfirmsRun } from "@/lib/pickup/notifyFollowersOnPickupConfirm";
import { sendPickupRsvpConfirmedPush } from "@/lib/pickup/pickupPushNotifications";
import { deletePendingWaitlistExpiringReminders, promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import {
  verifyEsportsRegistrationPaid,
  verifyPickupPaidAndConfirmed,
  verifyTournamentPaymentApplied,
} from "@/lib/payments/verifyStripeFulfillment";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { syncCaptainPlayersPaid } from "@/lib/tournament/syncCaptainPlayersPaid";
import {
  getStripeTournament,
  getStripeWebhookSecret,
  getSupabaseAdmin,
} from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function stripeEventLog(
  message: string,
  event: Pick<Stripe.Event, "id" | "type">,
  extra?: Record<string, string | null | undefined>,
) {
  const payload: Record<string, unknown> = {
    message,
    event_id: event.id,
    event_type: event.type,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") payload[k] = v;
    }
  }
  console.log(JSON.stringify({ stripe_webhook: true, ...payload }));
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  return pi?.id || null;
}

async function notifyPickupPlayerConfirmed(
  admin: SupabaseClient,
  runId: string,
  userId: string,
  wasAlreadyConfirmed: boolean,
): Promise<void> {
  if (wasAlreadyConfirmed) return;

  const runRes = await admin.from("pickup_runs").select("title").eq("id", runId).maybeSingle();
  await sendPickupRsvpConfirmedPush(admin, {
    userId,
    runId,
    runTitle: String(runRes.data?.title || ""),
  });

  try {
    await notifyFollowersWhenFollowedPlayerConfirmsRun(admin, { runId, playerId: userId });
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_fulfill_pickup_follower_join_notify_error:", msg);
  }
}

async function fulfillPickup(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    paymentIntentId: string | null;
    runId: string | undefined;
    userId: string | undefined;
  },
): Promise<void> {
  const { sessionId, paymentIntentId, runId, userId } = opts;

  if (sessionId) {
    const existing = await admin
      .from("pickup_run_rsvps")
      .select("id, status")
      .eq("checkout_session_id", sessionId)
      .maybeSingle();
    if (String(existing.data?.status || "").trim() === "confirmed") return;
  }

  if (runId && userId) {
    const prevRes = await admin
      .from("pickup_run_rsvps")
      .select("status")
      .eq("run_id", runId)
      .eq("user_id", userId)
      .maybeSingle();
    const wasAlreadyConfirmed = String(prevRes.data?.status || "").trim() === "confirmed";
    if (wasAlreadyConfirmed) return;
    await admin
      .from("pickup_run_rsvps")
      .update({
        status: "confirmed",
        paid_at: new Date().toISOString(),
        payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("user_id", userId);
    await deletePendingWaitlistExpiringReminders(admin, userId, runId);
    await ensurePickupRunInviteLink(admin, runId, userId);
    await addUserToRunBanterRoom(admin, runId, userId);
    await notifyPickupPlayerConfirmed(admin, runId, userId, false);
    return;
  }
  if (!sessionId) return;
  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("run_id,user_id,status")
    .eq("checkout_session_id", sessionId)
    .maybeSingle();
  if (!rsvp) return;
  const wasAlreadyConfirmed = String(rsvp.status || "").trim() === "confirmed";
  if (wasAlreadyConfirmed) return;
  await admin
    .from("pickup_run_rsvps")
    .update({
      status: "confirmed",
      paid_at: new Date().toISOString(),
      payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", rsvp.run_id)
    .eq("user_id", rsvp.user_id);
  await deletePendingWaitlistExpiringReminders(admin, String(rsvp.user_id), String(rsvp.run_id));
  await ensurePickupRunInviteLink(admin, rsvp.run_id, rsvp.user_id);
  await addUserToRunBanterRoom(admin, String(rsvp.run_id), String(rsvp.user_id));
  await notifyPickupPlayerConfirmed(admin, String(rsvp.run_id), String(rsvp.user_id), false);
}

async function fulfillTournament(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    paymentIntentId: string | null;
    captainId: string | undefined;
  },
) {
  const { sessionId, paymentIntentId, captainId } = opts;

  let pay: { id: string; status: string; captain_id: string } | null = null;

  if (sessionId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("id,status,captain_id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();
    if (String(data?.status || "").trim() === "captured") return;
    pay = data;
  }
  if (!pay && captainId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("id,status,captain_id")
      .eq("captain_id", captainId)
      .eq("status", "pending")
      .maybeSingle();
    pay = data;
  }
  if (!pay || pay.status === "captured") return;

  await admin
    .from("tournament_payments")
    .update({ status: "captured", stripe_payment_intent_id: paymentIntentId })
    .eq("id", pay.id);

  await admin
    .from("tournament_captains")
    .update({
      status: "payment_received",
      payment_method: "stripe",
      payment_received_at: new Date().toISOString(),
    })
    .eq("id", pay.captain_id);

  await syncCaptainPlayersPaid(admin, pay.captain_id);

  const { data: capRow } = await admin
    .from("tournament_captains")
    .select("user_id,tournament_id,team_name")
    .eq("id", pay.captain_id)
    .maybeSingle();
  if (capRow?.user_id && capRow.tournament_id) {
    await ensureTournamentTeamRoom(
      admin,
      pay.captain_id,
      String(capRow.tournament_id),
      String(capRow.team_name ?? "Team"),
      String(capRow.user_id),
    );
  }
  if (capRow?.user_id) {
    await sendPushToUsers(admin, [String(capRow.user_id)], {
      title: "Payment received",
      body: "Your team spot is confirmed. Build your roster in the Tournaments tab.",
      data: {
        kind: "tournament_captain_payment_confirmed",
        captain_id: pay.captain_id,
        tournament_id:
          capRow.tournament_id != null ? String(capRow.tournament_id) : "",
      },
    });
  }
}

async function downgradePickupPendingPaymentAfterFailure(
  admin: SupabaseClient,
  paymentIntentId: string,
  piMetadata: Stripe.Metadata | null | undefined,
) {
  const md = piMetadata || {};
  let runId = typeof md.run_id === "string" ? md.run_id.trim() : "";
  let userId = typeof md.user_id === "string" ? md.user_id.trim() : "";

  if (!runId || !userId) {
    const byPi = await admin
      .from("pickup_run_rsvps")
      .select("run_id,user_id")
      .eq("payment_intent_id", paymentIntentId)
      .eq("status", "pending_payment")
      .maybeSingle();
    if (byPi.data?.run_id && byPi.data?.user_id) {
      runId = String(byPi.data.run_id);
      userId = String(byPi.data.user_id);
    }
  }

  if (!runId || !userId) return;

  const maxPosRes = await admin
    .from("pickup_run_rsvps")
    .select("waitlist_position")
    .eq("run_id", runId)
    .eq("status", "waitlist")
    .order("waitlist_position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const maxPos =
    maxPosRes.data?.waitlist_position === null || maxPosRes.data?.waitlist_position === undefined
      ? 0
      : Number(maxPosRes.data.waitlist_position);
  const nextPos = (Number.isFinite(maxPos) ? maxPos : 0) + 1;
  const nowIso = new Date().toISOString();

  const up = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "waitlist",
      waitlist_position: nextPos,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      checkout_session_id: null,
      payment_intent_id: null,
      updated_at: nowIso,
    })
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("status", "pending_payment")
    .select("user_id");

  if (!up.error && Array.isArray(up.data) && up.data.length > 0) {
    await promoteNextWaitlistPlayer(admin, runId, { reason: "payment_failed" });
    try {
      await recomputePickupStandingForUser(admin, userId);
    } catch (e: unknown) {
      Sentry.captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("pickup_standing_recompute_after_payment_failed_rsvp:", msg);
    }
  }
}

async function fulfillEsports(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    paymentIntentId: string | null;
    registrationId: string | undefined;
  },
) {
  const { sessionId, paymentIntentId, registrationId } = opts;
  if (!registrationId) return;
  const now = new Date().toISOString();
  let q = admin
    .from("esports_tournament_registrations")
    .update({
      payment_status: "paid",
      paid_at: now,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: now,
    })
    .eq("id", registrationId);
  if (sessionId) {
    q = q.eq("stripe_checkout_session_id", sessionId);
  }
  await q;
}

async function handlePaidCheckoutSession(
  admin: SupabaseClient,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
) {
  const sessionId = session.id;
  const paymentIntentId = paymentIntentIdFromSession(session);
  const platformPaymentId = await findPlatformPaymentIdBySession(admin, sessionId);
  const now = new Date().toISOString();

  const md = session.metadata || {};
  const kind = md.kind;

  try {
    if (kind === "pickup") {
      await fulfillPickup(admin, {
        sessionId,
        paymentIntentId,
        runId: md.run_id,
        userId: md.user_id,
      });
      const v = await verifyPickupPaidAndConfirmed(admin, {
        runId: md.run_id,
        userId: md.user_id,
        sessionId,
      });

      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Checkout finished and the pickup spot was confirmed in the app."
          : "Checkout finished, but the pickup RSVP did not show as confirmed. Someone may need to fix this manually.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      if (md.user_id) {
        try {
          await recomputePickupStandingForUser(admin, String(md.user_id));
        } catch (e: unknown) {
          Sentry.captureException(e);
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_checkout:", msg);
        }
      }
      return NextResponse.json({ received: true });
    }

    if (kind === "tournament") {
      await fulfillTournament(admin, {
        sessionId,
        paymentIntentId,
        captainId: md.captain_id,
      });
      const v = await verifyTournamentPaymentApplied(admin, {
        sessionId,
        captainId: md.captain_id,
        paymentIntentId,
      });

      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Checkout finished and tournament registration was updated."
          : "Checkout finished, but tournament registration did not show as paid. Someone may need to fix this manually.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    }

    if (kind === "esports" && md.registration_id) {
      await fulfillEsports(admin, {
        sessionId,
        paymentIntentId,
        registrationId: md.registration_id,
      });
      const v = await verifyEsportsRegistrationPaid(admin, {
        sessionId,
        registrationId: md.registration_id,
        paymentIntentId,
      });

      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Checkout finished and esports entry fee was recorded."
          : "Checkout finished, but esports registration did not show as paid.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    }

    await logStripeWebhookEvent(admin, {
      platform_payment_id: platformPaymentId,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "ignored",
      staff_summary:
        "Checkout completed, but this product type is not handled yet in the payment tracker. No app changes were made from this event.",
      needs_retry: false,
    });
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    await patchPlatformPaymentBySessionId(admin, sessionId, {
      lifecycle_status: "payment_received",
      stripe_payment_intent_id: paymentIntentId,
      stripe_payment_received_at: now,
      fulfillment_status: "failed",
      fulfillment_message: msg,
      completed_at: null,
    });
    await logStripeWebhookEvent(admin, {
      platform_payment_id: platformPaymentId,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "processed_failed",
      staff_summary:
        "Stripe reported a successful checkout, but the app hit an error while updating records. Retrying may help if it was temporary.",
      needs_retry: true,
      error_detail: msg,
    });
    console.error("stripe_webhook_handler_error:", msg);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

async function handlePaymentIntentSucceeded(admin: SupabaseClient, event: Stripe.Event, pi: Stripe.PaymentIntent) {
  const md = pi.metadata || {};
  const paymentIntentId = pi.id;
  const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
  const now = new Date().toISOString();

  if (md.kind === "pickup" && md.run_id && md.user_id) {
    try {
      await fulfillPickup(admin, {
        sessionId: null,
        paymentIntentId,
        runId: md.run_id,
        userId: md.user_id,
      });
      const v = await verifyPickupPaidAndConfirmed(admin, {
        runId: md.run_id,
        userId: md.user_id,
        sessionId: null,
      });

      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Payment cleared and the pickup spot was confirmed."
          : "Payment cleared, but the pickup RSVP did not show as confirmed.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      if (md.user_id) {
        try {
          await recomputePickupStandingForUser(admin, String(md.user_id));
        } catch (e: unknown) {
          Sentry.captureException(e);
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_pi:", msg);
        }
      }
      return NextResponse.json({ received: true });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        fulfillment_status: "failed",
        fulfillment_message: msg,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_failed",
        staff_summary: "Payment cleared, but updating pickup records failed.",
        needs_retry: true,
        error_detail: msg,
      });
      console.error("stripe_webhook_handler_error:", msg);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
  }

  if (md.kind === "tournament" && md.captain_id) {
    try {
      await fulfillTournament(admin, {
        sessionId: null,
        paymentIntentId,
        captainId: md.captain_id,
      });
      const v = await verifyTournamentPaymentApplied(admin, {
        sessionId: null,
        captainId: md.captain_id,
        paymentIntentId,
      });

      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Payment cleared and tournament registration was updated."
          : "Payment cleared, but tournament registration did not show as paid.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        fulfillment_status: "failed",
        fulfillment_message: msg,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_failed",
        staff_summary: "Payment cleared, but updating tournament records failed.",
        needs_retry: true,
        error_detail: msg,
      });
      console.error("stripe_webhook_handler_error:", msg);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
  }

  if (md.kind === "esports" && md.registration_id) {
    try {
      await fulfillEsports(admin, {
        sessionId: null,
        paymentIntentId,
        registrationId: md.registration_id,
      });
      const v = await verifyEsportsRegistrationPaid(admin, {
        sessionId: null,
        registrationId: md.registration_id,
        paymentIntentId,
      });

      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_received_at: now,
        fulfillment_status: v.ok ? "succeeded" : "failed",
        fulfillment_message: v.ok ? null : v.detail,
        completed_at: v.ok ? now : null,
      });

      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: v.ok ? "processed_ok" : "processed_failed",
        staff_summary: v.ok
          ? "Payment cleared and esports entry fee was recorded."
          : "Payment cleared, but esports registration did not show as paid.",
        needs_retry: !v.ok,
        error_detail: v.ok ? null : v.detail,
      });
      return NextResponse.json({ received: true });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_received",
        fulfillment_status: "failed",
        fulfillment_message: msg,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_failed",
        staff_summary: "Payment cleared, but updating esports registration failed.",
        needs_retry: true,
        error_detail: msg,
      });
      console.error("stripe_webhook_handler_error:", msg);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
  }

  await logStripeWebhookEvent(admin, {
    platform_payment_id: platformPaymentId,
    stripe_event_id: event.id,
    event_type: event.type,
    outcome: "ignored",
    staff_summary:
      "A payment succeeded in Stripe, but it was not tied to a known product in this app. No records were changed.",
    needs_retry: false,
  });
  return NextResponse.json({ received: true });
}

export async function POST(req: Request) {
  let stripe: ReturnType<typeof getStripeTournament>;
  try {
    stripe = getStripeTournament();
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_config:", msg);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = getSupabaseAdmin();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const raw = Buffer.from(await req.arrayBuffer());

  let webhookSecret: string;
  try {
    webhookSecret = getStripeWebhookSecret();
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_config:", msg);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_signature_failed:", msg);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  stripeEventLog("stripe_webhook_received", event);
  stripeEventLog("stripe_webhook_verified", event);

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      return await handlePaidCheckoutSession(admin, event, session);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;
      const platformPaymentId = await findPlatformPaymentIdBySession(admin, sessionId);
      const now = new Date().toISOString();
      await patchPlatformPaymentBySessionId(admin, sessionId, {
        lifecycle_status: "checkout_expired",
        fulfillment_status: "pending",
        fulfillment_message: "Checkout expired before payment.",
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_ok",
        staff_summary: "Checkout expired before the customer paid. No charge was completed.",
        needs_retry: false,
      });
      const { data: payRow } = await admin
        .from("platform_payments")
        .select("user_id,product_type")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      if (payRow?.product_type === "pickup" && payRow.user_id) {
        try {
          await recomputePickupStandingForUser(admin, payRow.user_id);
        } catch (e: unknown) {
          Sentry.captureException(e);
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_expired:", msg);
        }
      }
      stripeEventLog("stripe_webhook_checkout_expired", event, { checkout_session_id: sessionId });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return await handlePaymentIntentSucceeded(admin, event, pi);
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentIntentId = pi.id;
      const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
      const lastErr = pi.last_payment_error?.message || null;
      await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
        lifecycle_status: "payment_failed",
        fulfillment_status: "pending",
        fulfillment_message: lastErr,
      });
      await logStripeWebhookEvent(admin, {
        platform_payment_id: platformPaymentId,
        stripe_event_id: event.id,
        event_type: event.type,
        outcome: "processed_ok",
        staff_summary: "The card or bank declined this payment (or it could not be completed).",
        needs_retry: false,
        error_detail: lastErr,
      });
      await downgradePickupPendingPaymentAfterFailure(admin, paymentIntentId, pi.metadata);
      const { data: payRow } = await admin
        .from("platform_payments")
        .select("user_id,product_type")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .maybeSingle();
      if (payRow?.product_type === "pickup" && payRow.user_id) {
        try {
          await recomputePickupStandingForUser(admin, payRow.user_id);
        } catch (e: unknown) {
          Sentry.captureException(e);
          const msg = e instanceof Error ? e.message : String(e);
          console.error("pickup_standing_recompute_after_payment_failed:", msg);
        }
      }
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const piRaw = charge.payment_intent;
      const paymentIntentId =
        typeof piRaw === "string" ? piRaw : (piRaw as Stripe.PaymentIntent | null)?.id ?? null;
      if (paymentIntentId) {
        const platformPaymentId = await findPlatformPaymentIdByPaymentIntent(admin, paymentIntentId);
        await patchPlatformPaymentByPaymentIntentId(admin, paymentIntentId, {
          lifecycle_status: "refunded",
          refunded_at: new Date().toISOString(),
        });
        await logStripeWebhookEvent(admin, {
          platform_payment_id: platformPaymentId,
          stripe_event_id: event.id,
          event_type: event.type,
          outcome: "processed_ok",
          staff_summary: "A refund was recorded in Stripe for this charge.",
          needs_retry: false,
        });
      } else {
        await logStripeWebhookEvent(admin, {
          platform_payment_id: null,
          stripe_event_id: event.id,
          event_type: event.type,
          outcome: "received_only",
          staff_summary:
            "Stripe sent a refund notice, but it could not be matched to a saved payment in this app.",
          needs_retry: false,
        });
      }
      return NextResponse.json({ received: true });
    }

    await logStripeWebhookEvent(admin, {
      platform_payment_id: null,
      stripe_event_id: event.id,
      event_type: event.type,
      outcome: "received_only",
      staff_summary: "This Stripe event was received. No app action is required for it right now.",
      needs_retry: false,
    });
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    Sentry.captureException(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe_webhook_handler_error:", msg);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
