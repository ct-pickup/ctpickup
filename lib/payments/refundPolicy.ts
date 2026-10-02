const DAY_MS = 24 * 60 * 60 * 1000;

export type RefundInitiator = "host" | "admin" | "player";
export type RefundTrigger = "run_cancel" | "rsvp_decline" | "leave";

export type RefundPolicyInput = {
  initiator: RefundInitiator;
  trigger: RefundTrigger;
  kickoffAt: string | number | null;
  /** Replaces kickoff minus 24 hours as the cutoff (decline uses run.cancellation_deadline for date-only start_at). */
  refundCutoffAt?: number | null;
  now: number;
  /** The checkout never completed and has been (or is being) stopped. */
  paymentPending: boolean;
  /** The current join has a card charge, even if it was already fully refunded. */
  hasCardCharge: boolean;
  /** Card charge still refundable: amount received minus amount refunded, photo package included. */
  cardNetCents: number;
  /** Part of the field fee the player's own pickup credit covered. */
  creditCoveredCents: number;
  playerId: string;
  /** Who paid the card charge: a friend (platform_payments.user_id with metadata.paid_for_user_id = player) or the player. */
  cardPayerId: string;
};

export type RefundCredit = { userId: string; cents: number; creditedForUserId: string | null };

export type RefundDecision =
  | { kind: "none"; reason: "paid_nothing" | "within_24h" }
  | { kind: "cancel_checkout"; reason: "payment_pending" }
  | {
      kind: "settle";
      reason: "host_or_admin_removal" | "player_leave_early";
      refundToCard: boolean;
      refundCardCents: number;
      credits: RefundCredit[];
    };

export function refundWindowOpen(opts: { kickoffAt: string | number | null; refundCutoffAt?: number | null; now: number }): boolean {
  let cutoff: number | null;
  if (opts.refundCutoffAt !== undefined) {
    cutoff = opts.refundCutoffAt;
  } else if (opts.kickoffAt == null) {
    cutoff = null;
  } else {
    cutoff = new Date(opts.kickoffAt).getTime() - DAY_MS;
  }
  return cutoff != null && Number.isFinite(cutoff) && opts.now < cutoff;
}

function cents(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * Pickup refund rule, one place for every route that removes a player from a run:
 *
 * - Unfinished checkout (pending payment): the checkout is cancelled so it cannot charge; nothing is refunded or credited.
 * - Paid nothing: nothing.
 * - Card refunds happen only when a host or admin acts.
 * - Host cancel (sessions/cancel, initiator "host") and admin cancel (sessions/cancel by an admin, admin/pickup/cancel,
 *   and the pickup/switch cancel_run action, initiator "admin"), trigger "run_cancel": the card-paid portion is refunded
 *   to the card that paid it (a friend's card when a friend paid), at any time, for what Stripe actually charged; the
 *   credit-covered portion comes back as a credit to the player whose credit it was. Runs cancelled before
 *   REFUND_FIX_CUTOFF are never settled again.
 * - Player leaves (sessions/leave, trigger "leave") or declines their own RSVP (pickup/rsvp decline, trigger
 *   "rsvp_decline"); both are player-initiated and follow the same rule: more than 24 hours before kickoff, what was
 *   paid becomes credit, never a card refund. The card portion goes to whoever paid it (a friend who paid gets a credit
 *   marked as being for this player's spot), the credit-covered portion to the player. Within 24 hours nothing comes
 *   back. Declining an invite or a waitlist spot involves no money.
 * - Run switch: there is no flow that moves a player from one run to another (pickup/switch is the admin run
 *   switchboard). A switch must not be settled through this function; it should carry the payment to the new run.
 *
 * "More than 24 hours" is strict: exactly 24 hours before kickoff is already inside the window.
 */
export function decidePickupRefund(input: RefundPolicyInput): RefundDecision {
  if (input.paymentPending) return { kind: "cancel_checkout", reason: "payment_pending" };

  const card = cents(input.cardNetCents);
  const covered = cents(input.creditCoveredCents);
  const early = refundWindowOpen(input);

  if (input.trigger === "run_cancel") {
    if (input.initiator === "player") throw new Error("A run can only be cancelled by its host or an admin.");
    if (!input.hasCardCharge && covered === 0) return { kind: "none", reason: "paid_nothing" };
    return {
      kind: "settle",
      reason: "host_or_admin_removal",
      refundToCard: input.hasCardCharge,
      refundCardCents: input.hasCardCharge ? card : 0,
      credits: covered > 0 ? [{ userId: input.playerId, cents: covered, creditedForUserId: null }] : [],
    };
  }

  if (input.initiator !== "player") throw new Error("Only the player can leave a run; hosts and admins cancel or remove.");
  if (!early) return { kind: "none", reason: "within_24h" };
  if (card === 0 && covered === 0) return { kind: "none", reason: "paid_nothing" };

  const credits: RefundCredit[] = [];
  const add = (userId: string, amount: number, creditedForUserId: string | null) => {
    if (amount <= 0) return;
    const hit = credits.find((c) => c.userId === userId && c.creditedForUserId === creditedForUserId);
    if (hit) hit.cents += amount;
    else credits.push({ userId, cents: amount, creditedForUserId });
  };
  add(input.playerId, covered, null);
  const friendPaid = input.cardPayerId !== input.playerId;
  add(friendPaid ? input.cardPayerId : input.playerId, card, friendPaid ? input.playerId : null);

  return { kind: "settle", reason: "player_leave_early", refundToCard: false, refundCardCents: 0, credits };
}
