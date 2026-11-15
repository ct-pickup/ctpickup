import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureTournamentTeamRoom } from "@/lib/chat/tournamentTeamRoom";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { isPaidOrReadyCaptainStatus } from "@/lib/tournament/outdoorTournamentConstants";
import { loadPaymentConfig } from "@/lib/tournament/paymentConfig";
import { syncCaptainPlayersPaid } from "@/lib/tournament/syncCaptainPlayersPaid";
import { isTestTournamentSlug } from "@/lib/tournament/testTournament";

/**
 * "Mark paid" and "Undo paid": the organizer collects a captain's money outside the app (Venmo or cash) and records it.
 *
 * MARK PAID does what the Stripe webhook does when a captain's card payment arrives (app/api/stripe/webhook/route.ts, fulfillTournament):
 *   1. the captain's status becomes "payment_received", the one status roster invites and Generate Groups look for
 *   2. payment_method and payment_received_at are set (the webhook sets "stripe"; here it is "manual")
 *   3. players_paid is synced from the roster
 *   4. the team chat room is created
 *   5. the captain gets the same push: "Payment received / Your team spot is confirmed. Build your roster in the Tournaments tab."
 * and, unlike the webhook, writes one line to admin_audit_log saying who did it and when.
 *
 * It NEVER touches tournament_payments (the Stripe records), never calls Stripe, never refunds or charges anything.
 * Idempotent: a team that is already paid is left alone (no second chat room, no second push).
 * Only for a tournament whose payments are handled outside the app, only for a captain the organizer approved.
 * A tournament whose slug starts with test- is marked the same way but silently: no push.
 *
 * UNDO PAID only undoes a manual payment: a team that paid by card is never changed here. It is refused once a bracket exists.
 */

export const PAYMENT_RECEIVED_PUSH = {
  title: "Payment received",
  body: "Your team spot is confirmed. Build your roster in the Tournaments tab.",
} as const;

export type ManualPayOutcome =
  | { ok: true; changed: boolean; status: string; audited: boolean }
  | { ok: false; status: number; code: string; error: string };

type CaptainRow = {
  id: string;
  tournament_id: string;
  user_id: string | null;
  status: string;
  team_name: string | null;
  captain_verified: boolean | null;
  payment_method: string | null;
};

async function loadCaptain(admin: SupabaseClient, tournamentId: string, captainId: string) {
  const r = await admin
    .from("tournament_captains")
    .select("id,tournament_id,user_id,status,team_name,captain_verified,payment_method")
    .eq("id", captainId)
    .maybeSingle();
  if (r.error) return { error: r.error.message as string, row: null };
  const row = r.data as CaptainRow | null;
  if (!row || String(row.tournament_id) !== String(tournamentId)) return { error: null, row: null };
  return { error: null, row };
}

async function audit(admin: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({ actor_id: actorId, action, detail });
    return !error;
  } catch {
    return false;
  }
}

async function gate(admin: SupabaseClient, tournamentId: string): Promise<{ ok: true; slug: string | null } | Extract<ManualPayOutcome, { ok: false }>> {
  const cfg = await loadPaymentConfig(admin, tournamentId);
  if (!cfg.ok) return { ok: false, status: 503, code: "unavailable", error: "Could not check how this tournament takes payment. Try again." };
  if (cfg.mode !== "manual") {
    return { ok: false, status: 409, code: "not_manual", error: "This tournament takes payment in the app (Stripe). Mark paid is only for tournaments where you collect payment yourself." };
  }
  const t = await admin.from("tournaments").select("slug").eq("id", tournamentId).maybeSingle();
  return { ok: true, slug: ((t.data as { slug?: string | null } | null)?.slug ?? null) };
}

export async function markCaptainPaid(admin: SupabaseClient, input: { tournamentId: string; captainId: string; actorId: string }): Promise<ManualPayOutcome> {
  const g = await gate(admin, input.tournamentId);
  if (!g.ok) return g;

  const c = await loadCaptain(admin, input.tournamentId, input.captainId);
  if (c.error) return { ok: false, status: 500, code: "failed", error: c.error };
  if (!c.row) return { ok: false, status: 404, code: "not_found", error: "Team not found in this tournament." };
  const cap = c.row;

  // Already paid (by hand or by card): nothing to do, nothing sent.
  if (isPaidOrReadyCaptainStatus(cap.status)) return { ok: true, changed: false, status: cap.status, audited: false };
  if (cap.status === "claim_rejected" || cap.status === "released_expired") {
    return { ok: false, status: 409, code: "claim_closed", error: "This claim was rejected or expired. The captain has to submit a new claim first." };
  }
  if (cap.captain_verified !== true) {
    return { ok: false, status: 409, code: "not_approved", error: "Approve this captain's claim first, then mark them paid." };
  }

  const now = new Date().toISOString();
  const up = await admin
    .from("tournament_captains")
    .update({ status: "payment_received", payment_method: "manual", payment_received_at: now })
    .eq("id", cap.id)
    .eq("status", cap.status); // compare and set: a second press (or a Stripe payment landing at the same moment) changes nothing twice
  if (up.error) return { ok: false, status: 500, code: "failed", error: up.error.message };

  const again = await loadCaptain(admin, input.tournamentId, cap.id);
  if (again.row && again.row.payment_method !== "manual" && again.row.status === "payment_received") {
    // A card payment got there first. It already did the rest.
    return { ok: true, changed: false, status: again.row.status, audited: false };
  }

  await syncCaptainPlayersPaid(admin, cap.id);

  const silent = isTestTournamentSlug(g.slug);
  if (cap.user_id) {
    await ensureTournamentTeamRoom(admin, cap.id, input.tournamentId, String(cap.team_name ?? "Team"), String(cap.user_id));
    if (!silent) {
      await sendPushToUsers(admin, [String(cap.user_id)], {
        title: PAYMENT_RECEIVED_PUSH.title,
        body: PAYMENT_RECEIVED_PUSH.body,
        data: { kind: "tournament_captain_payment_confirmed", captain_id: cap.id, tournament_id: input.tournamentId },
      });
    }
  }

  const audited = await audit(admin, input.actorId, "tournament_mark_paid", { tournament_id: input.tournamentId, captain_id: cap.id, team_name: cap.team_name, previous_status: cap.status, at: now });
  return { ok: true, changed: true, status: "payment_received", audited };
}

export async function undoCaptainPaid(admin: SupabaseClient, input: { tournamentId: string; captainId: string; actorId: string }): Promise<ManualPayOutcome> {
  const g = await gate(admin, input.tournamentId);
  if (!g.ok) return g;

  const c = await loadCaptain(admin, input.tournamentId, input.captainId);
  if (c.error) return { ok: false, status: 500, code: "failed", error: c.error };
  if (!c.row) return { ok: false, status: 404, code: "not_found", error: "Team not found in this tournament." };
  const cap = c.row;

  // Not paid: already undone.
  if (!isPaidOrReadyCaptainStatus(cap.status)) return { ok: true, changed: false, status: cap.status, audited: false };
  // A card payment is never undone from here.
  if (cap.payment_method !== "manual") {
    return { ok: false, status: 409, code: "not_manual_payment", error: "This team paid by card in the app. Refund it in Stripe if needed; it cannot be undone here." };
  }
  const m = await admin.from("tournament_matches").select("id").eq("tournament_id", input.tournamentId).limit(1);
  if (!m.error && (m.data ?? []).length > 0) {
    return { ok: false, status: 409, code: "bracket_exists", error: "The bracket has already been generated, so this team can no longer be marked unpaid." };
  }

  const up = await admin
    .from("tournament_captains")
    .update({ status: "claim_submitted", payment_method: null, payment_received_at: null })
    .eq("id", cap.id)
    .eq("status", cap.status);
  if (up.error) return { ok: false, status: 500, code: "failed", error: up.error.message };

  const audited = await audit(admin, input.actorId, "tournament_undo_paid", { tournament_id: input.tournamentId, captain_id: cap.id, team_name: cap.team_name, previous_status: cap.status, at: new Date().toISOString() });
  return { ok: true, changed: true, status: "claim_submitted", audited };
}
