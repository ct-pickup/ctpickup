import type { SupabaseClient } from "@supabase/supabase-js";

type Team = "A" | "B" | "C";

function isTeam(v: unknown): v is Team {
  return v === "A" || v === "B" || v === "C";
}

export function winLossForTeamAssignment(winningTeam: Team, playerTeam: Team): { w: number; l: number } {
  return playerTeam === winningTeam ? { w: 1, l: 0 } : { w: 0, l: 1 };
}

/**
 * Applies net win/loss deltas to `profiles.pickup_wins_count` / `pickup_losses_count` when a run result
 * is posted or edited. Old state is subtracted, new state is added (idempotent for unchanged rows).
 */
export async function applyPickupResultWinLossDeltas(
  admin: SupabaseClient,
  args: {
    oldWinningTeam: Team | null;
    oldAssignments: { user_id: string; team: Team }[];
    newWinningTeam: Team;
    newAssignments: { user_id: string; team: Team }[];
  },
): Promise<void> {
  const netW = new Map<string, number>();
  const netL = new Map<string, number>();

  function add(uid: string, dw: number, dl: number) {
    if (!dw && !dl) return;
    netW.set(uid, (netW.get(uid) || 0) + dw);
    netL.set(uid, (netL.get(uid) || 0) + dl);
  }

  if (args.oldWinningTeam && isTeam(args.oldWinningTeam) && args.oldAssignments.length) {
    for (const row of args.oldAssignments) {
      if (!isTeam(row.team)) continue;
      const { w, l } = winLossForTeamAssignment(args.oldWinningTeam, row.team);
      add(row.user_id, -w, -l);
    }
  }

  for (const row of args.newAssignments) {
    if (!isTeam(row.team)) continue;
    const { w, l } = winLossForTeamAssignment(args.newWinningTeam, row.team);
    add(row.user_id, w, l);
  }

  const uids = new Set([...netW.keys(), ...netL.keys()]);
  const now = new Date().toISOString();

  for (const uid of uids) {
    const dw = netW.get(uid) || 0;
    const dl = netL.get(uid) || 0;
    if (dw === 0 && dl === 0) continue;

    const profRes = await admin
      .from("profiles")
      .select("pickup_wins_count,pickup_losses_count")
      .eq("id", uid)
      .maybeSingle();

    if (profRes.error || !profRes.data) {
      console.error("[applyPickupResultWinLossDeltas] profile read failed:", profRes.error?.message, uid);
      continue;
    }

    const prof = profRes.data as { pickup_wins_count?: number | null; pickup_losses_count?: number | null };
    const nextW = Math.max(0, Number(prof.pickup_wins_count ?? 0) + dw);
    const nextL = Math.max(0, Number(prof.pickup_losses_count ?? 0) + dl);

    const up = await admin
      .from("profiles")
      .update({ pickup_wins_count: nextW, pickup_losses_count: nextL, updated_at: now })
      .eq("id", uid);

    if (up.error) {
      console.error("[applyPickupResultWinLossDeltas] profile update failed:", up.error.message, uid);
    }
  }
}
