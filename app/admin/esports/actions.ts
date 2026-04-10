"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

async function assertAdmin() {
  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  if (!user?.id) redirect("/login?next=" + encodeURIComponent("/admin/esports"));

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) redirect("/");
}

function parseTimestamp(label: string, raw: string): string {
  const s = raw.trim();
  if (!s) {
    redirect(`/admin/esports?e=${encodeURIComponent(`${label} is required.`)}`);
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    redirect(
      `/admin/esports?e=${encodeURIComponent(`${label} must be a valid date/time (ISO 8601 recommended).`)}`
    );
  }
  return new Date(ms).toISOString();
}

function parseOptionalTimestamp(label: string, raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    redirect(
      `/admin/esports?e=${encodeURIComponent(`${label} must be a valid date/time (ISO 8601 recommended).`)}`
    );
  }
  return new Date(ms).toISOString();
}

function parseOptionalJson(label: string, raw: string): unknown | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    redirect(`/admin/esports?e=${encodeURIComponent(`${label} must be valid JSON.`)}`);
  }
}

export async function createEsportsTournament(formData: FormData) {
  await assertAdmin();
  const title = String(formData.get("title") || "").trim();
  const game = String(formData.get("game") || "").trim();
  const prize = String(formData.get("prize") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const status = String(formData.get("status") || "upcoming").trim();
  const startRaw = String(formData.get("start_date") || "");
  const endRaw = String(formData.get("end_date") || "");
  const format_summary = String(formData.get("format_summary") || "").trim() || null;

  const group_stage_deadline_1 = parseOptionalTimestamp(
    "Group stage deadline 1",
    String(formData.get("group_stage_deadline_1") || ""),
  );
  const group_stage_deadline_2 = parseOptionalTimestamp(
    "Group stage deadline 2",
    String(formData.get("group_stage_deadline_2") || ""),
  );
  const group_stage_final_deadline = parseOptionalTimestamp(
    "Group stage final deadline",
    String(formData.get("group_stage_final_deadline") || ""),
  );
  const knockout_start_at = parseOptionalTimestamp(
    "Knockout start",
    String(formData.get("knockout_start_at") || ""),
  );
  const quarterfinal_deadline = parseOptionalTimestamp(
    "Quarterfinal deadline",
    String(formData.get("quarterfinal_deadline") || ""),
  );
  const semifinal_deadline = parseOptionalTimestamp(
    "Semifinal deadline",
    String(formData.get("semifinal_deadline") || ""),
  );
  const final_deadline = parseOptionalTimestamp(
    "Final deadline",
    String(formData.get("final_deadline") || ""),
  );

  if (!title || title.length < 2) {
    redirect("/admin/esports?e=" + encodeURIComponent("Title is required."));
  }
  if (!game) {
    redirect("/admin/esports?e=" + encodeURIComponent("Game is required."));
  }
  if (!prize) {
    redirect("/admin/esports?e=" + encodeURIComponent("Prize is required."));
  }
  if (!["upcoming", "active", "completed"].includes(status)) {
    redirect("/admin/esports?e=" + encodeURIComponent("Invalid status."));
  }

  const start_date = parseTimestamp("Start date", startRaw);
  const end_date = parseTimestamp("End date", endRaw);

  const svc = supabaseService();
  const { error } = await svc.from("esports_tournaments").insert({
    title,
    game,
    prize,
    start_date,
    end_date,
    status,
    description: description || null,
    format_summary,
    group_stage_deadline_1,
    group_stage_deadline_2,
    group_stage_final_deadline,
    knockout_start_at,
    quarterfinal_deadline,
    semifinal_deadline,
    final_deadline,
  });

  if (error) {
    redirect(`/admin/esports?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  redirect("/admin/esports?ok=created");
}

export async function updateEsportsTournament(formData: FormData) {
  await assertAdmin();
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect("/admin/esports?e=" + encodeURIComponent("Missing id."));

  const title = String(formData.get("title") || "").trim();
  const game = String(formData.get("game") || "").trim();
  const prize = String(formData.get("prize") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const format_summary = String(formData.get("format_summary") || "").trim() || null;
  const status = String(formData.get("status") || "").trim();
  const startRaw = String(formData.get("start_date") || "");
  const endRaw = String(formData.get("end_date") || "");

  const group_stage_deadline_1 = parseOptionalTimestamp(
    "Group stage deadline 1",
    String(formData.get("group_stage_deadline_1") || ""),
  );
  const group_stage_deadline_2 = parseOptionalTimestamp(
    "Group stage deadline 2",
    String(formData.get("group_stage_deadline_2") || ""),
  );
  const group_stage_final_deadline = parseOptionalTimestamp(
    "Group stage final deadline",
    String(formData.get("group_stage_final_deadline") || ""),
  );
  const knockout_start_at = parseOptionalTimestamp(
    "Knockout start",
    String(formData.get("knockout_start_at") || ""),
  );
  const quarterfinal_deadline = parseOptionalTimestamp(
    "Quarterfinal deadline",
    String(formData.get("quarterfinal_deadline") || ""),
  );
  const semifinal_deadline = parseOptionalTimestamp(
    "Semifinal deadline",
    String(formData.get("semifinal_deadline") || ""),
  );
  const final_deadline = parseOptionalTimestamp(
    "Final deadline",
    String(formData.get("final_deadline") || ""),
  );

  if (!title || !game || !prize) {
    redirect("/admin/esports?e=" + encodeURIComponent("Title, game, and prize are required."));
  }
  if (!["upcoming", "active", "completed"].includes(status)) {
    redirect("/admin/esports?e=" + encodeURIComponent("Invalid status."));
  }

  const start_date = parseTimestamp("Start date", startRaw);
  const end_date = parseTimestamp("End date", endRaw);

  const svc = supabaseService();
  const { error } = await svc
    .from("esports_tournaments")
    .update({
      title,
      game,
      prize,
      start_date,
      end_date,
      status,
      description: description || null,
      format_summary,
      group_stage_deadline_1,
      group_stage_deadline_2,
      group_stage_final_deadline,
      knockout_start_at,
      quarterfinal_deadline,
      semifinal_deadline,
      final_deadline,
    })
    .eq("id", id);

  if (error) {
    redirect(`/admin/esports?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  redirect("/admin/esports?ok=saved");
}

export async function updateEsportsTournamentKnockoutBracket(formData: FormData) {
  await assertAdmin();
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect("/admin/esports?e=" + encodeURIComponent("Missing id."));

  const bracketRaw = String(formData.get("knockout_bracket") || "");
  const knockout_bracket = parseOptionalJson("Knockout bracket", bracketRaw);

  const svc = supabaseService();
  const { error } = await svc
    .from("esports_tournaments")
    .update({ knockout_bracket })
    .eq("id", id);

  if (error) {
    redirect(`/admin/esports?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/esports/tournaments");
  revalidatePath(`/esports/tournaments/${id}`);
  revalidatePath("/admin/esports");
  redirect("/admin/esports?ok=saved");
}

export async function deleteEsportsTournament(formData: FormData) {
  await assertAdmin();
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect("/admin/esports?e=" + encodeURIComponent("Missing id."));

  const svc = supabaseService();
  const { error } = await svc.from("esports_tournaments").delete().eq("id", id);

  if (error) {
    redirect(`/admin/esports?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  redirect("/admin/esports?ok=deleted");
}
