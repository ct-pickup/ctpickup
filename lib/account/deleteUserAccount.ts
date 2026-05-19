import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripePickup, getStripeTournament } from "@/lib/server/runtimeClients";

export const ACCOUNT_DELETE_SUPPORT_ERROR =
  "Could not delete account. Please contact support at pickupct@gmail.com";

function throwIfDbError(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`${step}: ${error.message}`);
}

function isBenignStripeError(message: string): boolean {
  return /already|complete|expired|paid|canceled|cancelled|succeeded|no such|resource_missing/i.test(
    message,
  );
}

async function tryExpireCheckoutSession(stripe: Stripe, sessionId: string): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isBenignStripeError(msg)) return;
    throw e;
  }
}

async function tryCancelPaymentIntent(stripe: Stripe, paymentIntentId: string): Promise<void> {
  try {
    await stripe.paymentIntents.cancel(paymentIntentId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isBenignStripeError(msg)) return;
    throw e;
  }
}

/**
 * Expires open checkout sessions and cancels pending payment intents for this user.
 */
export async function cancelStripeActivityForUser(
  svc: SupabaseClient,
  userId: string,
  _email?: string | null,
): Promise<void> {
  void _email;

  const { data: platformRows, error: platformErr } = await svc
    .from("platform_payments")
    .select("stripe_checkout_session_id,stripe_payment_intent_id,product_type,lifecycle_status")
    .eq("user_id", userId)
    .eq("lifecycle_status", "checkout_started");

  throwIfDbError("platform_payments select", platformErr);

  let pickupStripe: Stripe | null = null;
  let tournamentStripe: Stripe | null = null;

  for (const row of platformRows || []) {
    const sessionId = row.stripe_checkout_session_id?.trim();
    const piId = row.stripe_payment_intent_id?.trim();
    const productType = String(row.product_type || "tournament");
    const stripe =
      productType === "pickup"
        ? (pickupStripe ??= getStripePickup())
        : (tournamentStripe ??= getStripeTournament());

    if (sessionId) await tryExpireCheckoutSession(stripe, sessionId);
    if (piId) await tryCancelPaymentIntent(stripe, piId);
  }

  const { data: esportsRegs, error: esportsErr } = await svc
    .from("esports_tournament_registrations")
    .select("stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("user_id", userId)
    .eq("payment_status", "checkout_started");

  throwIfDbError("esports_tournament_registrations select", esportsErr);

  if ((esportsRegs || []).length > 0) {
    const stripe = pickupStripe ?? getStripePickup();
    pickupStripe = stripe;
    for (const reg of esportsRegs || []) {
      const sessionId = reg.stripe_checkout_session_id?.trim();
      const piId = reg.stripe_payment_intent_id?.trim();
      if (sessionId) await tryExpireCheckoutSession(stripe, sessionId);
      if (piId) await tryCancelPaymentIntent(stripe, piId);
    }
  }

  const { data: captains, error: capErr } = await svc
    .from("tournament_captains")
    .select("id")
    .eq("user_id", userId);

  throwIfDbError("tournament_captains select", capErr);

  const captainIds = (captains || []).map((c) => c.id).filter(Boolean);
  if (captainIds.length > 0) {
    const { data: tourneyPayments, error: payErr } = await svc
      .from("tournament_payments")
      .select("stripe_session_id,stripe_payment_intent_id,status")
      .in("captain_id", captainIds)
      .eq("status", "pending");

    throwIfDbError("tournament_payments select", payErr);

    const stripe = tournamentStripe ?? getStripeTournament();
    tournamentStripe = stripe;
    for (const pay of tourneyPayments || []) {
      const sessionId = pay.stripe_session_id?.trim();
      const piId = pay.stripe_payment_intent_id?.trim();
      if (sessionId) await tryExpireCheckoutSession(stripe, sessionId);
      if (piId) await tryCancelPaymentIntent(stripe, piId);
    }
  }

  const { data: rsvps, error: rsvpErr } = await svc
    .from("pickup_run_rsvps")
    .select("payment_intent_id,checkout_session_id")
    .eq("user_id", userId)
    .eq("status", "pending_payment");

  throwIfDbError("pickup_run_rsvps select", rsvpErr);

  if ((rsvps || []).length > 0) {
    const stripe = pickupStripe ?? getStripePickup();
    for (const rsvp of rsvps || []) {
      const sessionId = rsvp.checkout_session_id?.trim();
      const piId = rsvp.payment_intent_id?.trim();
      if (sessionId) await tryExpireCheckoutSession(stripe, sessionId);
      if (piId) await tryCancelPaymentIntent(stripe, piId);
    }
  }
}

/**
 * Removes or anonymizes user-linked rows that block profile/auth deletion.
 */
export async function cleanupUserData(svc: SupabaseClient, userId: string): Promise<void> {
  throwIfDbError(
    "esports_match_reports delete",
    (await svc.from("esports_match_reports").delete().eq("reporter_user_id", userId)).error,
  );

  throwIfDbError(
    "esports_matches player1 nullify",
    (await svc.from("esports_matches").update({ player1_user_id: null }).eq("player1_user_id", userId))
      .error,
  );

  throwIfDbError(
    "esports_matches player2 nullify",
    (await svc.from("esports_matches").update({ player2_user_id: null }).eq("player2_user_id", userId))
      .error,
  );

  throwIfDbError(
    "esports_match_results delete",
    (await svc.from("esports_match_results").delete().eq("submitted_by_user_id", userId)).error,
  );

  throwIfDbError(
    "esports_conduct_records admin nullify",
    (
      await svc
        .from("esports_conduct_records")
        .update({ created_by_admin_user_id: null })
        .eq("created_by_admin_user_id", userId)
    ).error,
  );

  throwIfDbError(
    "esports_tournament_registrations delete",
    (await svc.from("esports_tournament_registrations").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "pickup_run_rsvps delete",
    (await svc.from("pickup_run_rsvps").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "pickup_run_invites delete",
    (await svc.from("pickup_run_invites").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "pickup_run_availability delete",
    (await svc.from("pickup_run_availability").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "tournament_roster delete",
    (await svc.from("tournament_roster").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "tournament_captains delete",
    (await svc.from("tournament_captains").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "referral_events delete",
    (
      await svc
        .from("referral_events")
        .delete()
        .or(`referrer_user_id.eq.${userId},referred_user_id.eq.${userId}`)
    ).error,
  );

  throwIfDbError(
    "user_push_devices delete",
    (await svc.from("user_push_devices").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "chat_room_members delete",
    (await svc.from("chat_room_members").delete().eq("user_id", userId)).error,
  );

  throwIfDbError(
    "platform_payments delete",
    (await svc.from("platform_payments").delete().eq("user_id", userId)).error,
  );
}

/**
 * Full account deletion: Stripe cleanup, DB cleanup, profile removal, auth user removal.
 */
export async function deleteUserAccount(
  svc: SupabaseClient,
  userId: string,
  email?: string | null,
): Promise<void> {
  await cancelStripeActivityForUser(svc, userId, email);
  await cleanupUserData(svc, userId);

  throwIfDbError(
    "profiles delete",
    (await svc.from("profiles").delete().eq("id", userId)).error,
  );

  const { error: authErr } = await svc.auth.admin.deleteUser(userId);
  if (authErr) throw new Error(`auth.admin.deleteUser: ${authErr.message}`);
}
