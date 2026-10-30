import type { SupabaseClient } from "@supabase/supabase-js";

import { claimAlertSlots } from "@/lib/alerts/fieldAlerts";
import { recordEvent } from "@/lib/analytics/events";
import { deliverRunInvite } from "@/lib/pickup/deliverRunInvite";
import { etSlot, playAgainAskCopy, playAgainCopy, repeatPrefill, slotLabel, type RepeatPrefill } from "@/lib/pickup/repeatGame";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export type PlayAgainRole = "host" | "attendee";
export type PlayAgainInfo = {
  eligible: boolean;
  role: PlayAgainRole | null;
  /** Players from that game who could be invited first (never includes the host). */
  previous_players: number;
  prefill: RepeatPrefill | null;
};

type Source = Record<string, unknown> & { id: string; created_by: string | null; start_at: string | null; status: string | null };

/** A game can be repeated once it has started or been marked done. Cancelled games cannot. */
export function isRepeatable(run: { start_at: string | null; status: string | null }, now: Date = new Date()): boolean {
  const st = (run.status ?? "").toLowerCase();
  if (st === "cancelled" || st === "canceled") return false;
  if (st === "completed") return true;
  const t = run.start_at ? Date.parse(run.start_at) : NaN;
  return Number.isFinite(t) && t <= now.getTime();
}

async function loadSource(admin: SupabaseClient, runId: string): Promise<Source | null> {
  const { data } = await admin.from("pickup_runs").select("*").eq("id", runId).maybeSingle();
  return (data as Source | null) ?? null;
}

/** Confirmed players of a game, minus the host. */
export async function previousPlayerIds(admin: SupabaseClient, runId: string, hostId: string | null): Promise<string[]> {
  const { data, error } = await admin.from("pickup_run_rsvps").select("user_id").eq("run_id", runId).eq("status", "confirmed");
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { user_id?: string }).user_id).filter((id): id is string => typeof id === "string" && id !== hostId))];
}

/**
 * Who the viewer is for this game. Only the host (or an admin) can set up the next game. Players who were in it can ask the host.
 */
export async function playAgainInfo(admin: SupabaseClient, runId: string, userId: string, now: Date = new Date()): Promise<PlayAgainInfo | null> {
  const run = await loadSource(admin, runId);
  if (!run) return null;
  const none: PlayAgainInfo = { eligible: false, role: null, previous_players: 0, prefill: null };
  if (!isRepeatable(run, now)) return none;
  let isAdmin = false;
  if (run.created_by !== userId) {
    const { data } = await admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
    isAdmin = (data as { is_admin?: boolean } | null)?.is_admin === true;
  }
  const players = await previousPlayerIds(admin, runId, run.created_by);
  if (run.created_by === userId || isAdmin) {
    const prefill = repeatPrefill(run, now);
    return { eligible: prefill !== null, role: "host", previous_players: players.length, prefill };
  }
  if (players.includes(userId)) return { eligible: true, role: "attendee", previous_players: players.length, prefill: null };
  return none;
}

/**
 * A new game made as a repeat. The previous players hear about it first and personally: a public game pushes them (and the caller
 * leaves them out of the general region push), an invite-only game invites them. One push per player per day at most.
 * Returns the ids that were handled so the caller can skip them. Never throws.
 */
export async function inviteFromPreviousGame(
  admin: SupabaseClient,
  args: { sourceRunId: string; hostId: string; hostName: string; newRun: { id: string; start_at: string; time_tbd: boolean }; inviteOnly: boolean },
): Promise<string[]> {
  let invited = 0;
  let handled: string[] = [];
  try {
    const source = await loadSource(admin, args.sourceRunId);
    const players = await previousPlayerIds(admin, args.sourceRunId, source?.created_by ?? args.hostId);
    // Only approved players are invited or pushed.
    const { data: profiles } = players.length ? await admin.from("profiles").select("id,approved,tier_rank").in("id", players) : { data: [] };
    const approved = ((profiles ?? []) as { id: string; approved?: boolean; tier_rank?: number | null }[]).filter((p) => p.approved === true);
    const ids = approved.map((p) => p.id);
    invited = ids.length;
    if (ids.length) {
      handled = ids;
      if (args.inviteOnly) {
        // deliverRunInvite links the invite and sends the invite push itself.
        for (const p of approved) {
          await deliverRunInvite(admin, { run: { id: args.newRun.id, start_at: args.newRun.start_at }, inviteeId: p.id, inviteeTierRank: p.tier_rank, inviterId: args.hostId });
        }
      } else {
        const claimed = await claimAlertSlots(admin, ids, "play_again", `run:${args.newRun.id}`, 24);
        if (claimed.length) {
          const slot = etSlot(args.newRun.start_at, args.newRun.time_tbd);
          const copy = playAgainCopy(args.hostName, slot ? slotLabel(slot.date, slot.time) : "next week");
          await sendPushToUsers(admin, claimed, {
            ...copy,
            data: { kind: "play_again", screen: `session/${args.newRun.id}`, run_id: args.newRun.id, url: `ctpickup://session/${args.newRun.id}` },
          });
        }
      }
    }
  } catch (e) {
    console.error("[playAgain] invite failed", e instanceof Error ? e.message : "unknown");
  }
  await recordEvent(admin, {
    key: `play_again_created:${args.sourceRunId}:${args.newRun.id}`,
    name: "play_again_created",
    userId: args.hostId,
    source: "server",
    properties: { run_id: args.sourceRunId, new_run_id: args.newRun.id, role: "host", count: invited },
  });
  return handled;
}

/** A player asks the host to run the game again. The host gets one push per game per day, however many players ask. */
export async function askHostToRepeat(admin: SupabaseClient, runId: string, userId: string, now: Date = new Date()): Promise<{ ok: true; notified: boolean } | { ok: false; status: number; error: string }> {
  const info = await playAgainInfo(admin, runId, userId, now);
  if (!info || info.role !== "attendee") return { ok: false, status: 403, error: "Only players from this game can ask." };
  const run = await loadSource(admin, runId);
  const hostId = run?.created_by;
  if (!hostId) return { ok: false, status: 404, error: "This game has no host." };
  const claimed = await claimAlertSlots(admin, [hostId], "play_again_ask", `run:${runId}`, 24);
  if (claimed.length) {
    await sendPushToUsers(admin, claimed, { ...playAgainAskCopy(), data: { kind: "play_again_ask", screen: `recap/${runId}`, run_id: runId, url: `ctpickup://recap/${runId}` } });
  }
  return { ok: true, notified: claimed.length > 0 };
}
