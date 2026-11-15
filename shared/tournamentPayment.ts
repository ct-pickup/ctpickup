import { TOURNAMENT_PRICE_PER_PLAYER_CENTS, captainEntryCents, chargedPlayers, formatUsd, perPlayerText, teamPriceRangeText } from "./tournamentPrice";

/**
 * How captains pay for a tournament. Pure: no React Native, Next, Stripe or Supabase.
 *
 *   stripe  In the app. The captain pays by card at the Stripe checkout. This is today's behavior and the default.
 *   manual  The organizer collects the money outside the app (Venmo or cash). The app never starts a checkout for this tournament, and
 *           the organizer marks each team paid by hand.
 *
 * Anything that is not exactly "manual" reads as stripe, so a missing, empty or unknown value can never switch a tournament out of
 * card payments (or, worse, out of the protection below) by accident.
 */

export type PaymentMode = "stripe" | "manual";

export function parsePaymentMode(value: unknown): PaymentMode {
  return typeof value === "string" && value.trim().toLowerCase() === "manual" ? "manual" : "stripe";
}

export const PAYMENT_MODE_OPTIONS: { mode: PaymentMode; label: string }[] = [
  { mode: "stripe", label: "In the app (Stripe)" },
  { mode: "manual", label: "I collect it myself (Venmo or cash)" },
];

export const PAYMENT_MODE_QUESTION = "How do captains pay?";

/** The instructions are free text from the organizer. A sensible limit, and no control characters. */
export const PAYMENT_INSTRUCTIONS_MAX = 600;

export function cleanPaymentInstructions(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) return null;
  return t.slice(0, PAYMENT_INSTRUCTIONS_MAX);
}

/** The note under the entry fee on the create form. It says what really happens for the chosen mode. */
export function entryFeeNote(mode: PaymentMode): string {
  if (mode === "manual") return "You collect payment yourself. Captains are not charged in the app.";
  return `${perPlayerText()}, charged for the team size each captain claims. ${teamPriceRangeText()}.`;
}

export const CREATE_DATE_PLACEHOLDER = "Select date and time";

/** The words shown for the organizer's reference only: what a team said it would owe, at the in-app price. */
export function owedText(expectedPlayers: unknown): string {
  const n = chargedPlayers(expectedPlayers);
  return `Owes ${formatUsd(captainEntryCents(expectedPlayers))} (${n} players × ${formatUsd(TOURNAMENT_PRICE_PER_PLAYER_CENTS)})`;
}

/** What the captain's app shows, and whether the Stripe pay button may appear. */
export type CaptainPaymentView =
  | { kind: "stripe" }
  | { kind: "manual_waiting_for_approval"; title: string; body: string }
  | { kind: "manual_approved"; title: string; body: string; instructions: string | null }
  | { kind: "manual_paid"; title: string; body: string };

export const MANUAL_APPROVED_TITLE = "Approved. Send payment as described below, then wait for confirmation.";
export const MANUAL_NO_INSTRUCTIONS_TEXT = "The organizer will tell you how to pay.";

/**
 * The state of one captain's payment screen. `approved` is the organizer's approval of the claim. Instructions are only ever part of
 * the approved state: a captain whose claim is not approved yet gets none.
 */
export function captainPaymentView(input: { mode: PaymentMode; approved: boolean; paid: boolean; instructions: string | null }): CaptainPaymentView {
  if (input.mode !== "manual") return { kind: "stripe" };
  if (input.paid) {
    return { kind: "manual_paid", title: "Payment received", body: "Your team spot is confirmed. Build your roster in the Tournaments tab." };
  }
  if (!input.approved) {
    return {
      kind: "manual_waiting_for_approval",
      title: "Claim sent",
      body: "Staff will review your claim. Once it is approved, you will see how to pay here.",
    };
  }
  return { kind: "manual_approved", title: MANUAL_APPROVED_TITLE, body: "Payment instructions", instructions: cleanPaymentInstructions(input.instructions) };
}

/** Marking a team paid by hand: the confirm text. */
export function markPaidConfirmText(teamName: string): string {
  return `Mark ${teamName.trim() || "this team"} as paid? They can then invite players.`;
}

/** Undoing it. */
export function undoPaidConfirmText(teamName: string): string {
  return `Mark ${teamName.trim() || "this team"} as NOT paid? They will no longer count as a paid team.`;
}
