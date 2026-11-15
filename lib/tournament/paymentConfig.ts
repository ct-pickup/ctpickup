import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanPaymentInstructions, parsePaymentMode, type PaymentMode } from "@/shared/tournamentPayment";

/**
 * How one tournament takes payment: in the app (Stripe, the default) or collected by the organizer outside the app.
 * Stored in tournaments.payment_mode and tournaments.payment_instructions (migration 20261107000000, additive, default "stripe").
 *
 * Fails safe to Stripe: a database without those columns, a missing row or an unknown value all read as "stripe", so nothing that exists
 * today changes before the migration is applied. A database ERROR that is not a missing column is reported as `unavailable`, and the
 * Stripe checkout then refuses rather than guess: it must never start a charge for a tournament it cannot tell is a Stripe one.
 */

export type PaymentConfig =
  | { ok: true; mode: PaymentMode; instructions: string | null; columns_missing: boolean }
  | { ok: false; error: string };

export function isMissingColumn(e: { message?: string; code?: string } | null | undefined): boolean {
  return !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));
}

export async function loadPaymentConfig(admin: SupabaseClient, tournamentId: string): Promise<PaymentConfig> {
  const r = await admin.from("tournaments").select("payment_mode,payment_instructions").eq("id", tournamentId).maybeSingle();
  if (r.error) {
    if (isMissingColumn(r.error)) return { ok: true, mode: "stripe", instructions: null, columns_missing: true };
    return { ok: false, error: r.error.message };
  }
  const row = r.data as { payment_mode?: unknown; payment_instructions?: unknown } | null;
  return { ok: true, mode: parsePaymentMode(row?.payment_mode), instructions: cleanPaymentInstructions(row?.payment_instructions), columns_missing: false };
}

/** What a checkout says when it refuses a tournament whose payments are handled outside the app. */
export const PAYMENTS_OUTSIDE_APP_ERROR = "payments_handled_outside_app";
export const PAYMENTS_OUTSIDE_APP_MESSAGE =
  "Payment for this tournament is handled outside the app. Follow the payment instructions from the organizer. You have not been charged.";
