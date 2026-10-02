import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import { isOnOrAfterRefundFixCutoff } from "@/lib/payments/pickupRefunds";
import { commitPlayerWithdrawal, planPlayerWithdrawal, type WithdrawalRsvp } from "@/lib/payments/playerWithdrawal";
import { cancelPickupRunAndSettle, type RunCancelRun } from "@/lib/payments/runCancelSettlement";

export type AccountDeletionFailure = { run_id: string; user_id: string | null; name: string | null; error: string };

export type AccountDeletionPreview = {
  upcoming_games: number;
  hosts_upcoming_runs: boolean;
  hosted_upcoming_runs: number;
  confirmation_required: boolean;
  message: string | null;
};

export type AccountDeletionErrorCode = "confirmation_required" | "settlement_failed" | "schema_not_ready" | "anonymize_failed";

/** A deletion that was stopped on purpose; nothing past the failing step ran, so the request can be retried. */
export class AccountDeletionError extends Error {
  constructor(
    public code: AccountDeletionErrorCode,
    public status: number,
    message: string,
    public extra: { failures?: AccountDeletionFailure[]; preview?: AccountDeletionPreview } = {},
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

const ACTIVE_RSVP_STATUSES = ["confirmed", "pending_payment"];

type RunRow = RunCancelRun & { created_by: string | null; cancellation_deadline: string | null };
type PlayerRsvp = WithdrawalRsvp & { run_id: string };

export type UpcomingCommitments = {
  hostedRuns: RunRow[];
  playerSpots: { run: RunRow; rsvp: PlayerRsvp }[];
};

/** Not started yet; a run with no start time (still being planned) counts as upcoming. */
export function isUpcomingRun(run: { start_at: string | null }, nowMs: number): boolean {
  if (!run.start_at) return true;
  const t = new Date(run.start_at).getTime();
  return !Number.isFinite(t) || t > nowMs;
}

function isOpenRun(run: { status: string | null }): boolean {
  return run.status !== "canceled" && run.status !== "completed";
}

const RUN_COLS = "id,title,created_by,fee_cents,start_at,cancellation_deadline,status,canceled_at";

/**
 * Runs the user hosts that still need the host-cancel flow (upcoming and open, or already cancelled after
 * REFUND_FIX_CUTOFF with players still unsettled from an earlier failed attempt), and the upcoming spots they hold
 * in other people's runs.
 */
export async function loadUpcomingCommitments(svc: SupabaseClient, userId: string, nowMs = Date.now()): Promise<UpcomingCommitments> {
  const { data: hostedData, error: hostedErr } = await svc.from("pickup_runs").select(RUN_COLS).eq("created_by", userId);
  if (hostedErr) throw new Error(`pickup_runs (hosted) select: ${hostedErr.message}`);
  const hosted = (hostedData || []) as RunRow[];

  const retryCandidates = hosted.filter((r) => r.status === "canceled" && isOnOrAfterRefundFixCutoff(r.canceled_at));
  const unsettled = new Set<string>();
  if (retryCandidates.length > 0) {
    const { data, error } = await svc
      .from("pickup_run_rsvps")
      .select("run_id")
      .in("run_id", retryCandidates.map((r) => r.id))
      .in("status", ACTIVE_RSVP_STATUSES);
    if (error) throw new Error(`pickup_run_rsvps (hosted) select: ${error.message}`);
    for (const r of data || []) unsettled.add(String(r.run_id));
  }
  const hostedRuns = hosted.filter((r) => (isOpenRun(r) && isUpcomingRun(r, nowMs)) || unsettled.has(r.id));

  const { data: rsvpData, error: rsvpErr } = await svc
    .from("pickup_run_rsvps")
    .select("run_id,status,paid_at,payment_intent_id,checkout_session_id,refund_id")
    .eq("user_id", userId)
    .in("status", ACTIVE_RSVP_STATUSES);
  if (rsvpErr) throw new Error(`pickup_run_rsvps select: ${rsvpErr.message}`);
  const rsvps = (rsvpData || []) as PlayerRsvp[];

  const runIds = [...new Set(rsvps.map((r) => r.run_id))];
  const runsById = new Map<string, RunRow>();
  if (runIds.length > 0) {
    const { data, error } = await svc.from("pickup_runs").select(RUN_COLS).in("id", runIds);
    if (error) throw new Error(`pickup_runs select: ${error.message}`);
    for (const r of (data || []) as RunRow[]) runsById.set(r.id, r);
  }
  const playerSpots = rsvps
    .map((rsvp) => ({ rsvp, run: runsById.get(rsvp.run_id) }))
    .filter((s): s is { rsvp: PlayerRsvp; run: RunRow } => !!s.run && s.run.created_by !== userId && isOpenRun(s.run) && isUpcomingRun(s.run, nowMs));

  return { hostedRuns, playerSpots };
}

export function previewFromCommitments(c: UpcomingCommitments): AccountDeletionPreview {
  const n = c.playerSpots.length;
  const h = c.hostedRuns.length;
  const parts: string[] = [];
  if (n > 0) parts.push(`You have ${n} upcoming game${n === 1 ? "" : "s"}. Deleting your account gives up those spots and any credits.`);
  if (h > 0) {
    parts.push(
      `You host ${h} upcoming run${h === 1 ? "" : "s"}. ${h === 1 ? "It" : "They"} will be cancelled first and every player refunded.`,
    );
  }
  return {
    upcoming_games: n,
    hosts_upcoming_runs: h > 0,
    hosted_upcoming_runs: h,
    confirmation_required: n > 0 || h > 0,
    message: parts.length ? parts.join(" ") : null,
  };
}

export async function previewAccountDeletion(svc: SupabaseClient, userId: string): Promise<AccountDeletionPreview> {
  return previewFromCommitments(await loadUpcomingCommitments(svc, userId));
}

/**
 * Cancels every upcoming run the user hosts through the host-cancel flow (card refunds, credits back, notifications).
 * Stops at the first run with a player who could not be settled; that run's unsettled RSVPs stay active, so a retry
 * picks it up again and refunds reuse their idempotency keys.
 */
export async function cancelHostedRunsForDeletion(
  svc: SupabaseClient,
  getStripe: () => Stripe,
  runs: RunRow[],
): Promise<void> {
  for (const run of runs) {
    const out = await cancelPickupRunAndSettle(svc, getStripe, {
      run,
      initiator: "host",
      reason: "The host deleted their account",
      routeTag: "account/delete",
    });
    if (out.status === 200) continue;
    const body = out.body as { error?: string; failures?: { user_id: string; name: string | null; error: string }[] };
    if (out.status === 409 && run.status === "canceled" && !(body.failures?.length)) continue;
    const failures: AccountDeletionFailure[] = (body.failures ?? []).map((f) => ({ run_id: run.id, ...f }));
    if (failures.length === 0) failures.push({ run_id: run.id, user_id: null, name: null, error: body.error ?? `HTTP ${out.status}` });
    throw new AccountDeletionError(
      "settlement_failed",
      502,
      `Could not cancel "${run.title ?? "your run"}" and refund every player, so your account was not deleted. Try again or contact support.`,
      { failures },
    );
  }
}

/**
 * Gives up each upcoming spot as a player-initiated leave under the shared refund policy. The deleted user's own
 * credit is forfeited (selfCredit dropped from the plan); a friend who paid still gets what the policy gives them, and
 * any card refund the policy issues goes to the card that paid. Stops at the first spot that fails.
 */
export async function leaveSpotsForDeletion(
  svc: SupabaseClient,
  getStripe: () => Stripe,
  userId: string,
  spots: { run: RunRow; rsvp: PlayerRsvp }[],
): Promise<string[]> {
  const warnings: string[] = [];
  for (const { run, rsvp } of spots) {
    const ctx = {
      admin: svc,
      getStripe,
      run,
      userId,
      sentryCtx: { tags: { route: "account/delete" }, extra: { run_id: run.id, user_id: userId } as Record<string, unknown> },
    };
    const planned = await planPlayerWithdrawal(ctx, rsvp, { preview: false });
    const committed = planned.ok
      ? await commitPlayerWithdrawal(ctx, { ...planned.plan, selfCredit: null }, { newStatus: "canceled" })
      : planned;
    if (!committed.ok) {
      throw new AccountDeletionError(
        "settlement_failed",
        502,
        `Could not give up your spot in "${run.title ?? "a session"}", so your account was not deleted. Try again or contact support.`,
        { failures: [{ run_id: run.id, user_id: userId, name: null, error: committed.error }] },
      );
    }
    warnings.push(...committed.result.warnings);
    const promoted = await promoteNextWaitlistPlayer(svc, run.id, { requestedBy: userId, reason: "player_cancel" });
    if (!promoted.ok) warnings.push(`Waitlist promotion for run ${run.id} failed: ${promoted.error}`);
  }
  return warnings;
}
