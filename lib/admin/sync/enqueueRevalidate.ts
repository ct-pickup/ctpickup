import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PATHS = ["/pickup", "/status/pickup", "/status/tournament", "/tournament"] as const;

/**
 * Records a revalidate job, runs it inline, and updates job row. Idempotent per job id.
 */
export async function enqueueRevalidateAndRun(
  admin: SupabaseClient,
  paths: string[],
): Promise<{ jobId: string | null; error: string | null }> {
  const unique = Array.from(new Set(paths.length ? paths : DEFAULT_PATHS));
  const ins = await admin
    .from("admin_sync_jobs")
    .insert({
      job_type: "revalidate",
      payload: { paths: unique },
      status: "pending",
      attempts: 0,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (ins.error || !ins.data?.id) {
    console.error("enqueueRevalidateAndRun insert:", ins.error?.message);
    return { jobId: null, error: ins.error?.message || "job_insert_failed" };
  }

  const jobId = ins.data.id as string;

  await admin
    .from("admin_sync_jobs")
    .update({
      status: "processing",
      attempts: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  try {
    for (const p of unique) {
      revalidatePath(p);
    }
    await admin
      .from("admin_sync_jobs")
      .update({
        status: "succeeded",
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", jobId);
    return { jobId, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("admin_sync_jobs")
      .update({
        status: "failed",
        last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { jobId, error: msg };
  }
}

export async function retryRevalidateJob(admin: SupabaseClient, jobId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: job, error: rErr } = await admin.from("admin_sync_jobs").select("*").eq("id", jobId).maybeSingle();
  if (rErr || !job) return { ok: false, error: rErr?.message || "not_found" };
  if (job.job_type !== "revalidate") return { ok: false, error: "unsupported_job_type" };

  const attempts = Number(job.attempts || 0) + 1;
  const max = Number(job.max_attempts || 8);
  if (attempts > max) {
    return { ok: false, error: "max_attempts" };
  }

  const paths = Array.isArray((job.payload as { paths?: string[] })?.paths)
    ? (job.payload as { paths: string[] }).paths
    : [...DEFAULT_PATHS];

  await admin
    .from("admin_sync_jobs")
    .update({ status: "processing", attempts, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    for (const p of paths) {
      revalidatePath(p);
    }
    await admin
      .from("admin_sync_jobs")
      .update({ status: "succeeded", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("admin_sync_jobs")
      .update({ status: "failed", last_error: msg, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: false, error: msg };
  }
}
