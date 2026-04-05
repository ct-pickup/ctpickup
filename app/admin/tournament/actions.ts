"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

async function assertAdmin() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) redirect("/login?next=/admin/tournament");

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) redirect("/");
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
  await assertAdmin();
  const id = String(formData.get("tournament_id") || "").trim();
  const svc = supabaseService();

  await deactivateAllTournaments(svc);

  if (id) {
    const { error } = await svc.from("tournaments").update({ is_active: true }).eq("id", id);
    if (error) redirect(`/admin/tournament?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/tournament");
  redirect("/admin/tournament?ok=active");
}

export async function clearActiveTournament() {
  await assertAdmin();
  const svc = supabaseService();
  await deactivateAllTournaments(svc);
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
  if (!Number.isFinite(maxTeams) || maxTeams < 1) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Max teams must be at least 1."));
  }
  if (officialThreshold > maxTeams) {
    redirect(
      "/admin/tournament?e=" + encodeURIComponent("Official threshold cannot exceed max teams.")
    );
  }
  if (targetTeams > maxTeams) {
    redirect("/admin/tournament?e=" + encodeURIComponent("Target teams cannot exceed max teams."));
  }

  const svc = supabaseService();
  const { error } = await svc.from("tournaments").insert({
    title,
    slug,
    target_teams: targetTeams,
    official_threshold: officialThreshold,
    max_teams: maxTeams,
    is_active: false,
  });

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
