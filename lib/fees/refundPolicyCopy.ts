/**
 * Plain-English refund snippets for checkout, summaries, and cross-references.
 * Esports: binding detail in Official Tournament Rules. Pickups: aligns with cancellation_deadline (24h before start_at).
 */

export const FEES_CROSS_REFERENCE_SUMMARY =
  "Tournament and pickup fees are generally non-refundable except as stated in the applicable refund policy: for in-person tournaments, refunds must be requested more than 48 hours before the tournament begins; for pickups, leaving more than 24 hours before kickoff gives you a credit for what you paid, and you receive a full refund if the host or Competitive Together cancels the game.";

export const PICKUP_REFUND_AVAILABILITY_SENTENCE =
  "If you leave a game more than 24 hours before kickoff, you get a credit for what you paid, usable on any future game.";

export const PICKUP_CANCELLATION_POLICY_HEADING = "Cancellations and refunds";

export const PICKUP_CANCELLATION_POLICY_POINTS = [
  "If you leave a game more than 24 hours before kickoff, you get a credit for what you paid, usable on any future game. Credits aren't cash and can't be refunded.",
  "If you leave within 24 hours of kickoff, there's no refund or credit.",
  "If the host or Competitive Together cancels a game, or removes you from it for reasons that aren't your fault, you get a full refund to your original payment method.",
  "If you ask us or the host to cancel your spot for you, the same rules apply as if you left yourself.",
  "If you're removed for breaking the rules (for example unsafe play or harassment), there's no refund or credit.",
  "If someone else paid for your spot, any credit goes to them.",
] as const;

export const LEGAL_POLICY_LAST_UPDATED = "Last updated: October 2, 2026";

/** Pickup page / how-it-works — full plain-English pickup refund summary */
export const PICKUP_REFUND_UI_NOTICE =
  "If you cancel more than 24 hours before the start time, what you paid becomes a credit. If you cancel within 24 hours of the start time or no-show, your fee is not refunded. Full refund to your card if the host or Competitive Together cancels the run. Verified duplicate or erroneous charges will be corrected.";

/** Stripe line item (pickup field fee) */
export const PICKUP_FIELD_FEE_STRIPE_DESCRIPTION =
  "Cancel 24+ hours before for a full credit. No refunds within 24h or for no-shows. If the run is cancelled, you get a full refund.";

/** Stripe line item (online esports entry) */
export const ESPORTS_ENTRY_FEE_STRIPE_DESCRIPTION =
  "Refund if requested >48h before published tournament start; no refund within 48h of start; organizer cancels before play = full refund; duplicate/erroneous charges corrected. See Official Rules §§8–9.";

/** Stripe line item (in-person captain tournament payment) */
export const IN_PERSON_TOURNAMENT_CAPTAIN_STRIPE_DESCRIPTION =
  "Refund if requested >48h before tournament begins; no refund within 48h of start; organizer cancels before play = full refund; duplicate/erroneous charges corrected.";

/** In-person captain tournament — modal / pre-payment UI */
export const IN_PERSON_TOURNAMENT_REFUND_NOTICE_UI =
  "Tournament entry fees are non-refundable unless you request a refund more than 48 hours before the tournament begins. If your refund request is made within 48 hours of the tournament start time, no refund is issued. If the Organizer cancels the tournament before play begins, entry fees are refunded. Verified duplicate or erroneous charges will be corrected.";
