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

export async function createEsportsTournament(formData: FormData) {
  await assertAdmin();
  const title = String(formData.get("title") || "").trim();
  const game = String(formData.get("game") || "").trim();
  const prize = String(formData.get("prize") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const status = String(formData.get("status") || "upcoming").trim();
  const startRaw = String(formData.get("start_date") || "");
  const endRaw = String(formData.get("end_date") || "");

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
  const status = String(formData.get("status") || "").trim();
  const startRaw = String(formData.get("start_date") || "");
  const endRaw = String(formData.get("end_date") || "");

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
    })
    .eq("id", id);

  if (error) {
    redirect(`/admin/esports?e=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/esports/tournaments");
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
