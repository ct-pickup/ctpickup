import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { SyncPickupTable } from "@/components/admin/SyncPickupTable";
import { StatusChip } from "@/components/admin/StatusChip";
import { fetchPickupSyncSummaries } from "@/lib/admin/pickupSyncSummaries";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";
import { retryDeliveryAction, retrySyncJobAction } from "./actions";
import {
  labelPublicationChannel,
  labelPublishSyncState,
  labelSyncJobStatus,
  labelSyncJobType,
} from "@/lib/admin/staffStatusLabels";

export const dynamic = "force-dynamic";

function fmt(dt: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "—";
  }
}

function toneForSurface(state: string | undefined): "synced" | "pending" | "failed" | "neutral" {
  if (state === "failed") return "failed";
  if (state === "pending") return "pending";
  const s = String(state || "").toLowerCase();
  if (s === "n/a" || s === "na") return "neutral";
  return "synced";
}

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; e?: string }>;
}) {
  const sp = await searchParams;

  let supabase;
  try {
    supabase = supabaseService();
  } catch {
    return (
      <main className="min-h-screen text-white">
        <PageTop flush title="Staff · Sync & status" fallbackHref={APP_HOME_URL} />
        <AdminWorkArea question="What has propagated, what is waiting on cron or checkpoints, and what failed configuration might block automation?">
          <p className="text-sm text-white/55">Database isn’t configured.</p>
        </AdminWorkArea>
      </main>
    );
  }

  const [
    summaries,
    cronSet,
    surfacesRes,
    jobsRes,
    failedDelRes,
    recentPubRes,
  ] = await Promise.all([
    fetchPickupSyncSummaries(supabase, 10),
    Promise.resolve(!!process.env.CRON_SECRET?.trim()),
    supabase.from("admin_surface_health").select("*").order("updated_at", { ascending: false }).limit(24),
    supabase.from("admin_sync_jobs").select("*").order("created_at", { ascending: false }).limit(15),
    supabase.from("admin_publication_deliveries").select("*").eq("sync_state", "failed").order("updated_at", { ascending: false }).limit(12),
    supabase.from("admin_publications").select("id, message, created_at").order("created_at", { ascending: false }).limit(6),
  ]);

  const layerMissing = [surfacesRes.error, jobsRes.error, failedDelRes.error, recentPubRes.error].some(
    (e) => e && /admin_|schema cache|does not exist|could not find the table/i.test(e.message || ""),
  );

  const surfaces = (surfacesRes.data || []) as {
    surface_key: string;
    label: string | null;
    sync_state: string;
    last_success_at: string | null;
    last_attempt_at: string | null;
    last_error: string | null;
    updated_at: string;
  }[];

  const jobs = (jobsRes.data || []) as {
    id: string;
    job_type: string;
    status: string;
    attempts: number;
    max_attempts: number;
    payload: { paths?: string[] };
    last_error: string | null;
    created_at: string;
  }[];

  const failedDeliveries = (failedDelRes.data || []) as {
    id: string;
    channel: string;
    entity_id: string | null;
    last_error: string | null;
    updated_at: string;
  }[];

  const recentPubRows = (recentPubRes.data || []) as {
    id: string;
    message: string;
    created_at: string;
  }[];

  const pubIds = recentPubRows.map((p) => p.id);
  const pubDelRes =
    pubIds.length && !layerMissing
      ? await supabase.from("admin_publication_deliveries").select("publication_id, channel, sync_state").in("publication_id", pubIds)
      : { data: [] as { publication_id: string; channel: string; sync_state: string }[] };

  const delsByPub = new Map<string, { channel: string; sync_state: string }[]>();
  for (const row of pubDelRes.data || []) {
    const list = delsByPub.get(row.publication_id) || [];
    list.push({ channel: row.channel, sync_state: row.sync_state });
    delsByPub.set(row.publication_id, list);
  }

  const recentPubs = recentPubRows.map((p) => ({
    ...p,
    deliveries: delsByPub.get(p.id) || [],
  }));

  return (
    <main className="min-h-screen text-white">
      <PageTop flush title="Staff · Sync & status" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="Where is automation caught up, where is it waiting, and what page refresh or delivery still needs a retry?">
        {sp.ok ? (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {sp.ok === "job" && "Page refresh job ran again."}
            {sp.ok === "delivery" && "Delivery retried."}
          </div>
        ) : null}
        {sp.e ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {sp.e}
          </div>
        ) : null}

        {layerMissing ? (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Publish and sync tracking aren’t set up on this database yet. Your developer should apply the latest staff
            migration, then redeploy or refresh the database cache.
          </div>
        ) : null}

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Content surfaces</h2>
            <Link href="/admin/publish" className="text-xs font-semibold text-white/70 hover:text-white">
              Unified publish →
            </Link>
          </div>
          <p className="text-xs text-white/45">
            Last attempts for site status, pickup posts, and tournament copy. Failed items stay failed until you fix the
            issue or retry.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-white/50">
                <tr className="border-b border-white/10">
                  <th className="p-3">Place</th>
                  <th className="p-3">Delivery</th>
                  <th className="p-3">Last success</th>
                  <th className="p-3">Last error</th>
                </tr>
              </thead>
              <tbody>
                {surfaces.length === 0 ? (
                  <tr>
                    <td className="p-4 text-white/50" colSpan={4}>
                      {layerMissing ? "—" : "No surface pings yet — publish once or post from Pickups."}
                    </td>
                  </tr>
                ) : (
                  surfaces.map((s) => (
                    <tr key={s.surface_key} className="border-b border-white/10 align-top">
                      <td className="p-3">
                        <div className="font-medium text-white">{s.label || s.surface_key}</div>
                      </td>
                      <td className="p-3">
                        <StatusChip tone={toneForSurface(s.sync_state)} title={s.sync_state}>
                          {labelPublishSyncState(s.sync_state)}
                        </StatusChip>
                      </td>
                      <td className="p-3 text-white/60">{fmt(s.last_success_at)}</td>
                      <td className="p-3 text-xs text-red-200/90">{s.last_error || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Page refresh jobs</h2>
          <p className="text-xs text-white/45">
            After each publish, the site queues a job to refresh public pages. Failed jobs can be retried here.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-white/50">
                <tr className="border-b border-white/10">
                  <th className="p-3">Job</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Tries</th>
                  <th className="p-3">Pages</th>
                  <th className="p-3">Error</th>
                  <th className="p-3"> </th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td className="p-4 text-white/50" colSpan={6}>
                      {layerMissing ? "—" : "No jobs yet."}
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.id} className="border-b border-white/10 align-top">
                      <td className="p-3 text-white/80" title={j.job_type}>
                        {labelSyncJobType(j.job_type)}
                      </td>
                      <td className="p-3">
                        <StatusChip
                          tone={
                            j.status === "succeeded"
                              ? "synced"
                              : j.status === "failed"
                                ? "failed"
                                : "pending"
                          }
                          title={j.status}
                        >
                          {labelSyncJobStatus(j.status)}
                        </StatusChip>
                      </td>
                      <td className="p-3 text-white/65" title={`${j.attempts} of ${j.max_attempts} tries`}>
                        {j.attempts} / {j.max_attempts}
                      </td>
                      <td className="p-3 text-xs text-white/55 font-mono">
                        {(j.payload?.paths || []).join(", ") || "—"}
                      </td>
                      <td className="p-3 text-xs text-red-200/90">{j.last_error || "—"}</td>
                      <td className="p-3">
                        {j.status === "failed" && j.job_type === "revalidate" ? (
                          <form action={retrySyncJobAction}>
                            <input type="hidden" name="job_id" value={j.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                            >
                              Retry
                            </button>
                          </form>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Failed publication deliveries</h2>
          <p className="text-xs text-white/45">Sends the saved message again to the destination that failed — safe to run twice.</p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-white/50">
                <tr className="border-b border-white/10">
                  <th className="p-3">Destination</th>
                  <th className="p-3">Target ID</th>
                  <th className="p-3">Error</th>
                  <th className="p-3"> </th>
                </tr>
              </thead>
              <tbody>
                {failedDeliveries.length === 0 ? (
                  <tr>
                    <td className="p-4 text-white/50" colSpan={4}>
                      No failed deliveries.
                    </td>
                  </tr>
                ) : (
                  failedDeliveries.map((d) => (
                    <tr key={d.id} className="border-b border-white/10 align-top">
                      <td className="p-3 text-white/85" title={d.channel}>
                        {labelPublicationChannel(d.channel)}
                      </td>
                      <td className="p-3 text-xs font-mono text-white/55">{d.entity_id || "—"}</td>
                      <td className="p-3 text-xs text-red-200/90">{d.last_error || "—"}</td>
                      <td className="p-3">
                        <form action={retryDeliveryAction}>
                          <input type="hidden" name="delivery_id" value={d.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                          >
                            Resync
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Recent unified publications</h2>
          <ul className="space-y-3 text-sm">
            {recentPubs.length === 0 ? (
              <li className="text-white/50">{layerMissing ? "—" : "None yet."}</li>
            ) : (
              recentPubs.map((p) => {
                const dels = p.deliveries || [];
                const failed = dels.filter((x) => x.sync_state === "failed").length;
                return (
                  <li key={p.id} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                    <div className="text-xs text-white/40">{fmt(p.created_at)}</div>
                    <p className="mt-1 text-white/80 line-clamp-3">{p.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {failed ? (
                        <StatusChip tone="failed">{failed} not delivered</StatusChip>
                      ) : (
                        <StatusChip tone="synced">All destinations ok</StatusChip>
                      )}
                      <span className="text-xs text-white/45">
                        {dels.length
                          ? dels.map((x) => labelPublicationChannel(x.channel)).join(", ")
                          : "No destinations"}
                      </span>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">Automation prerequisites</h2>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone={cronSet ? "synced" : "incomplete"} title="Secret the cron job sends">
              Automation secret {cronSet ? "set" : "missing"}
            </StatusChip>
            <StatusChip tone="neutral">Stripe payments: see Settings</StatusChip>
          </div>
          <p className="text-sm text-white/55">
            Pickup checkpoints run when the scheduled job on your host calls the processor with the automation secret. You still
            launch outreach from Pickups when you’re ready.
          </p>
          <Link href="/admin/settings" className="text-sm text-white underline-offset-4 hover:underline">
            Open settings
          </Link>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Pickup auto-pipeline</h2>
            <Link href="/admin/pickup" className="text-xs font-semibold text-white/70 hover:text-white">
              Manage runs →
            </Link>
          </div>
          <p className="text-xs text-white/45">
            “Last automation change” is when timed pickup steps last changed the run. If the public site looks stale, run the
            processor for that run or check failed refresh jobs above.
          </p>
          <SyncPickupTable summaries={summaries} />
        </section>

        <p className="mt-6 text-xs text-white/40">
          After publish, affected public pages refresh in the background so visitors see changes on their next load.
        </p>
      </AdminWorkArea>
    </main>
  );
}
