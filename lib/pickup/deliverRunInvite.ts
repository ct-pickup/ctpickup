import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

/**
 * Host-to-player run invite: links the invitee in pickup_run_invites (the gate
 * for select runs and the in-app invite) and sends the invite push.
 */
export async function deliverRunInvite(
  admin: SupabaseClient,
  args: {
    run: { id: string; start_at: string };
    inviteeId: string;
    inviteeTierRank: number | null | undefined;
    inviterId: string;
  },
): Promise<{ ok: true; alreadyLinked: boolean } | { ok: false; error: string }> {
  const { run, inviteeId } = args;

  // pickup_run_invites columns: run_id, user_id, wave, invited_tier_rank, invited_at
  // (no invited_by column; host is implied via pickup_runs.created_by)
  const { data: existingInvite } = await admin
    .from("pickup_run_invites")
    .select("user_id")
    .eq("run_id", run.id)
    .eq("user_id", inviteeId)
    .maybeSingle();

  if (!existingInvite) {
    const now = new Date().toISOString();
    const { error: insErr } = await admin.from("pickup_run_invites").insert({
      run_id: run.id,
      user_id: inviteeId,
      wave: 1,
      invited_tier_rank: Number(args.inviteeTierRank ?? 6),
      invited_at: now,
    });
    if (insErr && !/duplicate|unique/i.test(insErr.message || "")) {
      console.error("[deliverRunInvite] pickup_run_invites insert:", insErr.message);
      return { ok: false, error: "Could not save invite." };
    }
  }

  const { data: host } = await admin
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", args.inviterId)
    .maybeSingle();

  const hostName = [host?.first_name, host?.last_name].filter(Boolean).join(" ") || host?.username || "Someone";
  const sessionDate = new Date(run.start_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  await sendPushToUsers(admin, [inviteeId], {
    title: "Session invite 🎯",
    body: `${hostName} invited you to their session on ${sessionDate}`,
    data: { screen: `session/${run.id}`, run_id: run.id, url: `ctpickup://session/${run.id}` },
  });

  return { ok: true, alreadyLinked: !!existingInvite };
}
