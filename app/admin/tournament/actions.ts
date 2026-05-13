"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordTournamentActivationChange } from "@/lib/admin/surfaceHealth";
import { enqueueRevalidateAndRun } from "@/lib/admin/sync/enqueueRevalidate";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { deactivateActiveTournamentsInRegionBucket } from "@/lib/tournament/deactivateActiveByRegionBucket";

async function assertAdmin(): Promise<string> {
  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  if (!user?.id) redirect("/login?next=/admin/tournament");

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) redirect("/");
  return user.id;
}

async function deactivateAllTournaments(svc: ReturnType<typeof supabaseService>) {
  const { data: rows, error } = await svc.from("tournaments").select("id");
  if (error) redirect(`/admin/tournament?e=${encodeURIComponent(error.message)}`);
  for (const r of rows ?? []) {
    const { error: uErr } = await svc.from("tournaments").update({ is_active: false }).eq("id", r.id);
    if (uErr) redirect(`/admin/tournament?e=${encodeURIComponent(uErr.message)}`);
  }
}

export async function setActiveTournament(formData: FormData) {
  const actorId = await assertAdmin();
  const id = String(formData.get("tournament_id") || "").trim();
  const svc = supabaseService();

  if (!id) {
    await deactivateAllTournaments(svc);
  } else {
    const { data: row, error: rErr } = await svc.from("tournaments").select("service_region").eq("id", id).maybeSingle();
    if (rErr) redirect(`/admin/tournament?e=${encodeURIComponent(rErr.message)}`);
    if (!row) redirect(`/admin/tournament?e=${encodeURIComponent("Tournament not found.")}`);
    const sr = (row as { service_region?: string | null }).service_region;
    const bucket = sr != null && String(sr).trim() !== "" ? String(sr).trim() : null;
    const { error: dErr } = await deactivateActiveTournamentsInRegionBucket(svc, bucket);
    if (dErr) redirect(`/admin/tournament?e=${encodeURIComponent(dErr.message)}`);
    const { error } = await svc.from("tournaments").update({ is_active: true }).eq("id", id);
    if (error) redirect(`/admin/tournament?e=${encodeURIComponent(error.message)}`);
  }

  await recordTournamentActivationChange(svc, actorId);
  await enqueueRevalidateAndRun(svc, ["/tournament", "/status/tournament"]);
  revalidatePath("/admin/tournament");
  redirect("/admin/tournament?ok=active");
}

export async function clearActiveTournament() {
  const actorId = await assertAdmin();
  const svc = supabaseService();
  await deactivateAllTournaments(svc);
  await recordTournamentActivationChange(svc, actorId);
  await enqueueRevalidateAndRun(svc, ["/tournament", "/status/tournament"]);
  revalidatePath("/admin/tournament");
  redirect("/admin/tournament?ok=cleared");
}

export async function createTournament(formData: FormData) {
  await assertAdmin();
  const title = String(formData.get("title") || "").trim();
  let slug = String(formData.get("slug") || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const targetTeams = Number(formData.get("target_teams"));
  const officialThreshold = Number(formData.get("official_threshold"));
  const maxTeams = Number(formData.get("max_teams"));

  if (!title || title.length < 2) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Title is required."));
  }
  if (!slug || slug.length < 2) {
    slug = title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }
  if (!slug) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Slug is required."));
  }
  if (!Number.isFinite(targetTeams) || targetTeams < 1) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Target teams must be at least 1."));
  }
  if (!Number.isFinite(officialThreshold) || officialThreshold < 1) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Official threshold must be at least 1."));
  }
  if (!Number.isFinite(maxTeams) || maxTeams < 8 || maxTeams > 12) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Maximum teams must be between 8 and 12."));
  }
  if (officialThreshold > maxTeams) {
    redirect(
      "/admin/tournament?e=" + encodeURIComponent("Official threshold cannot exceed max teams.")
    );
  }
  if (targetTeams > maxTeams) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Target teams cannot exceed max teams."));
  }

  const regionRaw = String(formData.get("service_region") || "").trim().toUpperCase();
  const HUB = new Set(["NY", "CT", "NJ", "MD"]);
  const service_region = regionRaw && HUB.has(regionRaw) ? regionRaw : null;

  const venue = String(formData.get("venue") || "").trim() || null;
  const start_at = String(formData.get("start_at") || "").trim() || null;
  const format_summary = String(formData.get("format_summary") || "").trim() || null;
  const entry_fee_cents = Number(formData.get("entry_fee_cents"));
  const min_roster_players = Number(formData.get("min_roster_players"));

  const row: Record<string, unknown> = {
    title,
    slug,
    target_teams: targetTeams,
    official_threshold: officialThreshold,
    max_teams: maxTeams,
    is_active: false,
  };
  if (service_region) row.service_region = service_region;
  if (venue) row.venue = venue;
  if (start_at) row.start_at = start_at;
  if (format_summary) row.format_summary = format_summary;
  if (Number.isFinite(entry_fee_cents) && entry_fee_cents > 0) row.entry_fee_cents = Math.floor(entry_fee_cents);
  if (Number.isFinite(min_roster_players) && min_roster_players >= 1) row.min_roster_players = Math.floor(min_roster_players);

  const svc = supabaseService();
  const { error } = await svc.from("tournaments").insert(row);

  if (error) redirect(`/admin/tournament?e=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/tournament");
  redirect("/admin/tournament?ok=created");
}

const DECISIONS = new Set(["pending", "confirmed", "standby", "rejected"]);

export async function updateTourneySubmission(formData: FormData) {
  await assertAdmin();
  const id = String(formData.get("submission_id") || "").trim();
  const decision = String(formData.get("decision") || "pending").trim().toLowerCase();
  const notes = String(formData.get("notes") || "").trim();
  const reviewed = formData.get("reviewed") === "on";

  if (!id) redirect("/admin/tournament?e=" + encodeURIComponent("Missing submission id."));
  if (!DECISIONS.has(decision)) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Invalid decision."));
  }

  const svc = supabaseService();
  const { error } = await svc
    .from("tourney_submissions")
    .update({
      decision,
      reviewed,
      notes: notes || null,
    })
    .eq("id", id);

  if (error) redirect(`/admin/tournament?e=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/tournament");
  redirect("/admin/tournament?ok=saved");
}
