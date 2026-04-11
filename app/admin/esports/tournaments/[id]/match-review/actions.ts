"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { insertMatchAuditEvent } from "@/lib/esports/matchWorkflowServer";
import type { EsportsConductSeverity } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

async function assertAdmin(tournamentIdForRedirect: string) {
  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  const back = `/admin/esports/tournaments/${tournamentIdForRedirect}/match-review`;
  if (!user?.id) redirect("/login?next=" + encodeURIComponent(back));

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_admin) redirect("/");
  return user;
}

function mustUuid(label: string, raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error(`${label} is required.`);
  if (!/^[0-9a-fA-F-]{36}$/.test(s)) throw new Error(`${label} must be a UUID.`);
  return s;
}

function mustIntInRange(label: string, raw: unknown, min: number, max: number): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label} must be an integer.`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}

const ADMIN_STATUSES: EsportsMatchWorkflowStatus[] = [
  "scheduled",
  "awaiting_confirmation",
  "disputed",
  "under_review",
  "completed",
  "void",
  "forfeit",
];

export async function staffFinalizeMatch(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  const user = await assertAdmin(tournament_id);
  const match_id = mustUuid("Match id", formData.get("match_id"));

  const status = String(formData.get("status") || "").trim() as EsportsMatchWorkflowStatus;
  if (!ADMIN_STATUSES.includes(status)) throw new Error("Invalid status.");

  const winner_raw = String(formData.get("winner_user_id") || "").trim();
  const winner_user_id = winner_raw ? mustUuid("Winner", winner_raw) : null;

  const s1raw = String(formData.get("score_player1") || "").trim();
  const s2raw = String(formData.get("score_player2") || "").trim();
  const score_player1 = s1raw === "" ? null : Number(s1raw);
  const score_player2 = s2raw === "" ? null : Number(s2raw);

  if (score_player1 != null && (!Number.isInteger(score_player1) || score_player1 < 0)) {
    throw new Error("Score (player 1) must be a non-negative integer.");
  }
  if (score_player2 != null && (!Number.isInteger(score_player2) || score_player2 < 0)) {
    throw new Error("Score (player 2) must be a non-negative integer.");
  }

  const admin_notes_internal = String(formData.get("admin_notes_internal") || "").trim() || null;

  const svc = supabaseService();
  const now = new Date().toISOString();

  const { error } = await svc
    .from("esports_matches")
    .update({
      status,
      winner_user_id,
      score_player1,
      score_player2,
      admin_notes_internal,
      finalized_by_admin_user_id: user.id,
      finalized_at: now,
      updated_at: now,
    })
    .eq("id", match_id)
    .eq("tournament_id", tournament_id);

  if (error) throw new Error(error.message);

  await insertMatchAuditEvent(svc, {
    matchId: match_id,
    actorUserId: user.id,
    eventType: "staff_finalized_match",
    payload: {
      status,
      winner_user_id,
      score_player1,
      score_player2,
      admin_notes_internal,
    },
  });

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/match-review`);
  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  revalidatePath(`/esports/tournaments/${tournament_id}/play`);
  redirect(`/admin/esports/tournaments/${tournament_id}/match-review?ok=finalized`);
}

export async function staffIssueConduct(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  const user = await assertAdmin(tournament_id);

  const target_user_id = mustUuid("Player", formData.get("user_id"));
  const match_id_raw = String(formData.get("match_id") || "").trim();
  const match_id = match_id_raw ? mustUuid("Match id", match_id_raw) : null;

  const severity = String(formData.get("severity") || "").trim() as EsportsConductSeverity;
  if (!["warning", "strike", "forfeit", "disqualification"].includes(severity)) {
    throw new Error("Invalid severity.");
  }

  const reason_category = String(formData.get("reason_category") || "").trim() || null;
  const notes_internal = String(formData.get("notes_internal") || "").trim() || null;

  const svc = supabaseService();
  const { error } = await svc.from("esports_conduct_records").insert({
    user_id: target_user_id,
    tournament_id,
    match_id,
    severity,
    reason_category,
    notes_internal,
    created_by_admin_user_id: user.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/match-review`);
  redirect(`/admin/esports/tournaments/${tournament_id}/match-review?ok=conduct`);
}

export async function staffUpdateTournamentMatchPolicies(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);

  const match_confirmation_deadline_hours = mustIntInRange(
    "Confirmation window (hours)",
    formData.get("match_confirmation_deadline_hours"),
    1,
    336,
  );
  const require_match_proof = formData.get("require_match_proof") === "on";
  const policyRaw = String(formData.get("match_no_response_policy") || "staff_review").trim();
  const match_no_response_policy = policyRaw === "auto_finalize_report" ? "auto_finalize_report" : "staff_review";

  const svc = supabaseService();
  const { error } = await svc
    .from("esports_tournaments")
    .update({
      match_confirmation_deadline_hours,
      require_match_proof,
      match_no_response_policy,
    })
    .eq("id", tournament_id);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/match-review`);
  revalidatePath(`/esports/tournaments/${tournament_id}/play`);
  redirect(`/admin/esports/tournaments/${tournament_id}/match-review?ok=policies`);
}

export async function staffResetMatchReport(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  const user = await assertAdmin(tournament_id);
  const match_id = mustUuid("Match id", formData.get("match_id"));

  const svc = supabaseService();

  const { error: d1 } = await svc.from("esports_match_reports").delete().eq("match_id", match_id);
  if (d1) throw new Error(d1.message);

  const now = new Date().toISOString();
  const { error: d2 } = await svc
    .from("esports_matches")
    .update({
      status: "scheduled",
      winner_user_id: null,
      score_player1: null,
      score_player2: null,
      admin_notes_internal: null,
      finalized_by_admin_user_id: null,
      finalized_at: null,
      updated_at: now,
    })
    .eq("id", match_id)
    .eq("tournament_id", tournament_id);
  if (d2) throw new Error(d2.message);

  await insertMatchAuditEvent(svc, {
    matchId: match_id,
    actorUserId: user.id,
    eventType: "staff_reset_match_for_new_report",
    payload: {},
  });

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/match-review`);
  revalidatePath(`/esports/tournaments/${tournament_id}/play`);
  redirect(`/admin/esports/tournaments/${tournament_id}/match-review?ok=reset`);
}
