import type { SupabaseClient } from "@supabase/supabase-js";

export async function verifyPickupPaidAndConfirmed(
  admin: SupabaseClient,
  opts: {
    runId?: string | undefined;
    userId?: string | undefined;
    sessionId: string | null;
  },
): Promise<{ ok: boolean; detail: string }> {
  const { runId, userId, sessionId } = opts;

  if (runId && userId) {
    const { data: rsvp } = await admin
      .from("pickup_run_rsvps")
      .select("status,paid_at")
      .eq("run_id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (rsvp?.status === "confirmed" && rsvp?.paid_at) {
      return { ok: true, detail: "Pickup RSVP is confirmed and marked paid." };
    }
    return {
      ok: false,
      detail: "Pickup RSVP is not confirmed or missing a paid time after checkout.",
    };
  }

  if (!sessionId) {
    return { ok: false, detail: "Missing pickup identifiers to verify RSVP." };
  }

  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status,paid_at,run_id,user_id")
    .eq("checkout_session_id", sessionId)
    .maybeSingle();

  if (rsvp?.status === "confirmed" && rsvp?.paid_at) {
    return { ok: true, detail: "Pickup RSVP is confirmed and marked paid." };
  }
  return {
    ok: false,
    detail: "No confirmed pickup RSVP linked to this checkout session.",
  };
}

export async function verifyTournamentPaymentApplied(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    captainId: string | undefined;
    paymentIntentId: string | null;
  },
): Promise<{ ok: boolean; detail: string }> {
  let captainId = opts.captainId;
  let pay: { status: string; captain_id: string } | null = null;

  if (opts.sessionId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("status,captain_id")
      .eq("stripe_session_id", opts.sessionId)
      .maybeSingle();
    pay = data;
    captainId = captainId || pay?.captain_id;
  }

  if (!pay && opts.paymentIntentId) {
    const { data } = await admin
      .from("tournament_payments")
      .select("status,captain_id")
      .eq("stripe_payment_intent_id", opts.paymentIntentId)
      .maybeSingle();
    pay = data;
    captainId = captainId || pay?.captain_id;
  }

  if (!captainId) {
    return {
      ok: false,
      detail: "Could not find a tournament registration linked to this payment.",
    };
  }

  const { data: cap } = await admin
    .from("tournament_captains")
    .select("status")
    .eq("id", captainId)
    .maybeSingle();

  if (pay?.status === "captured" && cap?.status === "payment_received") {
    return { ok: true, detail: "Tournament captain payment is captured and registration updated." };
  }

  return {
    ok: false,
    detail: "Tournament payment or captain registration did not reach the expected paid state.",
  };
}

export async function verifyEsportsRegistrationPaid(
  admin: SupabaseClient,
  opts: {
    sessionId: string | null;
    registrationId: string | undefined;
    paymentIntentId: string | null;
  },
): Promise<{ ok: boolean; detail: string }> {
  const { sessionId, registrationId } = opts;

  if (sessionId) {
    const { data } = await admin
      .from("esports_tournament_registrations")
      .select("payment_status,paid_at")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (data?.payment_status === "paid" && data.paid_at) {
      return { ok: true, detail: "Esports registration shows paid after checkout." };
    }
  }

  if (registrationId) {
    const { data } = await admin
      .from("esports_tournament_registrations")
      .select("payment_status,paid_at")
      .eq("id", registrationId)
      .maybeSingle();
    if (data?.payment_status === "paid" && data.paid_at) {
      return { ok: true, detail: "Esports registration shows paid after checkout." };
    }
  }

  return {
    ok: false,
    detail: "Esports registration payment was not recorded as paid.",
  };
}
