import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { AccountDeletionError } from "@/lib/account/accountDeletionPlan";
import { assertPlansTestKey } from "@/lib/plans/stripePlans";

/**
 * Account deletion, billing part for Fields plans. Before the user is deleted:
 *   - every live Concierge subscription (plan_subscriptions) is cancelled in Stripe, then marked canceled here
 *   - every season purchase still waiting for payment has its Checkout Session expired (so it can no longer be paid) and is marked canceled
 * If Stripe fails, this throws and the caller must stop: nothing has been deleted yet, so the request can be retried.
 * Stripe test mode unless STRIPE_PLANS_ALLOW_LIVE is "1" (assertPlansTestKey). A user with no plans never touches Stripe, so a missing key does not block them.
 */

const LIVE_STATUSES = ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"];

/** Stripe says the thing is already gone / done: that is the outcome we wanted. */
function alreadyDone(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "resource_missing" || /no such (subscription|checkout)|already (been )?(canceled|cancelled|expired)|only (open|`open`)|status of `?(complete|expired)/i.test(msg);
}

const fail = (what: string) =>
  new AccountDeletionError("billing_cancel_failed", 502, `We couldn't cancel your ${what} with our payment provider, so your account was not deleted. Please try again, or contact support.`);

export type StripeLike = Pick<Stripe, "subscriptions" | "checkout">;

export async function cancelPlansForUser(
  svc: SupabaseClient,
  userId: string,
  makeStripe: () => StripeLike = () => new Stripe(assertPlansTestKey()),
  nowIso: string = new Date().toISOString(),
): Promise<{ subscriptionsCanceled: number; purchasesCanceled: number }> {
  const { data: subs, error: se } = await svc.from("plan_subscriptions").select("stripe_subscription_id,status").eq("user_id", userId);
  if (se) throw new Error(`plan_subscriptions: ${se.message}`);
  const { data: buys, error: be } = await svc.from("season_purchases").select("id,status,stripe_checkout_session_id").eq("user_id", userId);
  if (be) throw new Error(`season_purchases: ${be.message}`);

  const liveSubs = ((subs ?? []) as { stripe_subscription_id: string; status: string }[]).filter((s) => LIVE_STATUSES.includes(s.status));
  const openBuys = ((buys ?? []) as { id: string; status: string; stripe_checkout_session_id: string | null }[]).filter((b) => b.status === "pending");
  if (liveSubs.length === 0 && openBuys.length === 0) return { subscriptionsCanceled: 0, purchasesCanceled: 0 };

  const stripe = makeStripe();

  for (const s of liveSubs) {
    try {
      await stripe.subscriptions.cancel(s.stripe_subscription_id);
    } catch (e) {
      if (!alreadyDone(e)) throw fail("Concierge subscription");
    }
    const { error } = await svc.from("plan_subscriptions").update({ status: "canceled" }).eq("stripe_subscription_id", s.stripe_subscription_id);
    if (error) throw new Error(`plan_subscriptions update: ${error.message}`);
  }

  for (const b of openBuys) {
    if (b.stripe_checkout_session_id) {
      try {
        await stripe.checkout.sessions.expire(b.stripe_checkout_session_id);
      } catch (e) {
        if (!alreadyDone(e)) throw fail("season payment");
      }
    }
    const { error } = await svc.from("season_purchases").update({ status: "canceled", updated_at: nowIso }).eq("id", b.id);
    if (error) throw new Error(`season_purchases update: ${error.message}`);
  }

  return { subscriptionsCanceled: liveSubs.length, purchasesCanceled: openBuys.length };
}
