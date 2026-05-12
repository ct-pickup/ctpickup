/**
 * Plain-English refund snippets for checkout, summaries, and cross-references.
 * Esports: binding detail in Official Tournament Rules. Pickups: aligns with cancellation_deadline (24h before start_at).
 */

export const FEES_CROSS_REFERENCE_SUMMARY =
  "Tournament and pickup fees are generally non-refundable except as stated in the applicable refund policy: for in-person tournaments, refunds must be requested more than 48 hours before the tournament begins; for pickups, refunds are available if you cancel more than 24 hours before the run's scheduled start time, and you receive a full refund if the organizer cancels the run.";

export const PICKUP_REFUND_AVAILABILITY_SENTENCE =
  "Refunds are available if you cancel more than 24 hours before the run's scheduled start time.";

/** Pickup page / how-it-works — full plain-English pickup refund summary */
export const PICKUP_REFUND_UI_NOTICE = `${PICKUP_REFUND_AVAILABILITY_SENTENCE} If you cancel within 24 hours of the start time or no-show, your fee is not refunded. Full refund if the run is canceled by the organizer. Verified duplicate or erroneous charges will be corrected.`;

/** Stripe line item (pickup field fee) */
export const PICKUP_FIELD_FEE_STRIPE_DESCRIPTION =
  "Non-refundable unless you cancel more than 24h before the run start; no refund within 24h of start or for no-shows; full refund if the organizer cancels the run; duplicate/erroneous charges corrected.";

/** Stripe line item (online esports entry) */
export const ESPORTS_ENTRY_FEE_STRIPE_DESCRIPTION =
  "Refund if requested >48h before published tournament start; no refund within 48h of start; organizer cancels before play = full refund; duplicate/erroneous charges corrected. See Official Rules §§8–9.";

/** Stripe line item (in-person captain tournament payment) */
export const IN_PERSON_TOURNAMENT_CAPTAIN_STRIPE_DESCRIPTION =
  "Refund if requested >48h before tournament begins; no refund within 48h of start; organizer cancels before play = full refund; duplicate/erroneous charges corrected.";

/** In-person captain tournament — modal / pre-payment UI */
export const IN_PERSON_TOURNAMENT_REFUND_NOTICE_UI =
  "Tournament entry fees are non-refundable unless you request a refund more than 48 hours before the tournament begins. If your refund request is made within 48 hours of the tournament start time, no refund is issued. If the Organizer cancels the tournament before play begins, entry fees are refunded. Verified duplicate or erroneous charges will be corrected.";
