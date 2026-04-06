"use server";

import { redirect } from "next/navigation";
import { retryPublicationDelivery } from "@/lib/admin/publish/executePublication";
import { retryRevalidateJob } from "@/lib/admin/sync/enqueueRevalidate";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

async function assertAdmin(): Promise<string> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) redirect("/login?next=/admin/sync");

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) redirect("/");
  return user.id;
}

export async function retrySyncJobAction(formData: FormData) {
  await assertAdmin();
  const jobId = String(formData.get("job_id") || "").trim();
  if (!jobId) redirect("/admin/sync?e=" + encodeURIComponent("Missing job id"));

  const svc = supabaseService();
  const res = await retryRevalidateJob(svc, jobId);
  if (!res.ok) redirect("/admin/sync?e=" + encodeURIComponent(res.error || "retry_failed"));
  redirect("/admin/sync?ok=job");
}

export async function retryDeliveryAction(formData: FormData) {
  const actorId = await assertAdmin();
  const deliveryId = String(formData.get("delivery_id") || "").trim();
  if (!deliveryId) redirect("/admin/sync?e=" + encodeURIComponent("Missing delivery id"));

  const svc = supabaseService();
  const res = await retryPublicationDelivery(svc, deliveryId, actorId);
  if (!res.ok) redirect("/admin/sync?e=" + encodeURIComponent(res.error || "retry_failed"));
  redirect("/admin/sync?ok=delivery");
}
