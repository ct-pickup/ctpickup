import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StaffPublishPanel } from "@/components/admin/StaffPublishPanel";
import { StatusChip } from "@/components/admin/StatusChip";
import { fetchPickupSyncSummaries } from "@/lib/admin/pickupSyncSummaries";
import { isPublishLayerAvailable } from "@/lib/admin/publishLayer";
import { loadRecentOperatorContext } from "@/lib/admin/recentOperatorContext";
import { RecentOperatorActivity } from "@/components/admin/RecentOperatorActivity";
import { APP_HOME_URL } from "@/lib/siteNav";
import { labelPickupRunStatus } from "@/lib/admin/staffStatusLabels";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function clip(s: string | null | undefined, n: number) {
  const t = (s || "").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function fmt(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "—";
  }
}

export default async function AdminDashboardPage() {
  let supabase;
  try {
    supabase = supabaseService();
  } catch {
    return (
      <main className="min-h-screen text-ink">
        <PageTop flush title="Staff · Dashboard" fallbackHref={APP_HOME_URL} />
        <AdminWorkArea question="What is blocked or missing right now?">
          <p className="text-small text-muted">Database isn’t configured on the server.</p>
        </AdminWorkArea>
      </main>
    );
  }

  const publishLayerOk = await isPublishLayerAvailable(supabase);

  const [
    currentRunRes,
    runsRes,
    activeTournamentRes,
    tournamentsCountRes,
    statusRes,
    guidancePendingRes,
    syncSummaries,
    failedDelCountRes,
    stuckJobsCountRes,
    lastPubRes,
    recentLines,
  ] = await Promise.all([
    supabase
      .from("pickup_runs")
      .select("id,title,status,start_at,run_type,is_current,final_slot_id,outreach_started_at,created_at")
      .eq("is_current", true)
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pickup_runs")
      .select("id,title,status,start_at,is_current,final_slot_id,outreach_started_at,auto_managed")
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("tournaments").select("id,title,slug,is_active").eq("is_active", true).limit(1).maybeSingle(),
    supabase.from("tournaments").select("id", { count: "exact", head: true }),
    supabase
      .from("status_updates")
      .select("phase,announcement,next_update_by")
      .eq("id", 1)
      .maybeSingle(),
    supabase.from("guidance_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    fetchPickupSyncSummaries(supabase, 6),
    publishLayerOk
      ? supabase.from("admin_publication_deliveries").select("id", { count: "exact", head: true }).eq("sync_state", "failed")
      : Promise.resolve({ count: 0, error: null as null }),
    publishLayerOk
      ? supabase.from("admin_sync_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"])
      : Promise.resolve({ count: 0, error: null as null }),
    publishLayerOk
      ? supabase
          .from("admin_publications")
          .select("message, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as { message: string; created_at: string } | null }),
    loadRecentOperatorContext(supabase),
  ]);

  const runs = runsRes.data || [];
  const now = Date.now();
  const nextUpdateBy = statusRes.data?.next_update_by ? new Date(statusRes.data.next_update_by).getTime() : null;
  const announcement = (statusRes.data?.announcement || "").trim();
  const statusScheduled = nextUpdateBy !== null && !Number.isNaN(nextUpdateBy) && nextUpdateBy > now;
  const statusDraft = !announcement;

  const incompleteRuns = runs.filter((r) => {
    const st = String(r.status || "");
    if (st === "canceled") return false;
    const needsSlot = !r.final_slot_id && st !== "active";
    const needsOutreach = !r.outreach_started_at && st !== "active" && st !== "canceled";
    return needsSlot || (needsOutreach && st !== "draft");
  });

  const draftLike = runs.filter((r) => String(r.status) === "draft" || String(r.status) === "planning");

  const upcomingPickups = runs
    .filter((r) => r.start_at && new Date(r.start_at).getTime() > now)
    .sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime())
    .slice(0, 5);

  const pendingSyncRows = syncSummaries.filter((s) => {
    if (!s.auto_managed) return false;
    const due =
      s.next_step.startsWith("Due:") ||
      s.next_step.includes("checkpoint") ||
      s.next_step.includes("Add at least one time slot");
    return due;
  });

  const guidancePending = guidancePendingRes.count ?? 0;
  const noActiveTournament = !activeTournamentRes.data;
  const noPromotedRun = !currentRunRes.data;

  const publishLayerMissing = !publishLayerOk;
  const failedDeliveries = publishLayerMissing ? 0 : failedDelCountRes.count ?? 0;
  const stuckJobs = publishLayerMissing ? 0 : stuckJobsCountRes.count ?? 0;
  const lastPub = publishLayerMissing ? null : lastPubRes.data;

  const publishRuns = runs.map((r) => ({
    id: r.id,
    title: r.title,
    is_current: !!r.is_current,
    status: r.status,
  }));

  return (
    <main className="min-h-screen text-ink">
      <PageTop flush title="Staff · Dashboard" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="What needs attention right now, what is live for visitors, and where should you click next?">
        {/* Attention */}
        <section className="mb-10 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-caption font-semibold text-muted">Needs attention</h2>
            {guidancePending > 0 ? <StatusChip tone="pending">{guidancePending} guidance inbox</StatusChip> : null}
            {pendingSyncRows.length > 0 ? (
              <StatusChip tone="pending">{pendingSyncRows.length} pickup pipeline items</StatusChip>
            ) : null}
            {!publishLayerMissing && failedDeliveries > 0 ? (
              <StatusChip tone="failed">{failedDeliveries} publish didn’t finish</StatusChip>
            ) : null}
            {!publishLayerMissing && stuckJobs > 0 ? (
              <StatusChip tone="pending">{stuckJobs} sync jobs need attention</StatusChip>
            ) : null}
            {noPromotedRun ? <StatusChip tone="incomplete">No hub pickup</StatusChip> : null}
            {noActiveTournament ? <StatusChip tone="neutral">No live tournament</StatusChip> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guidancePending > 0 ? (
              <Link
                href="/admin/guidance"
                className="rounded-card border border-line bg-overlay-subtle p-4 transition hover:border-line"
              >
                <div className="text-small font-semibold text-ink">Guidance requests</div>
                <p className="mt-1 text-caption text-muted">{guidancePending} pending — review and update status.</p>
              </Link>
            ) : null}

            {draftLike.slice(0, 4).map((r) => (
              <Link
                key={r.id}
                href="/admin/pickup"
                className="rounded-card border border-coral bg-overlay-subtle p-4 transition hover:border-coral"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone="draft">Draft / planning</StatusChip>
                </div>
                <div className="mt-2 text-small font-semibold text-ink">{r.title || "Untitled run"}</div>
                <p className="mt-1 text-caption text-muted">Finish slots, outreach, and visibility in Pickups.</p>
              </Link>
            ))}

            {incompleteRuns
              .filter((r) => !draftLike.find((d) => d.id === r.id))
              .slice(0, 3)
              .map((r) => (
                <Link
                  key={r.id}
                  href="/admin/pickup"
                  className="rounded-card border border-coral bg-overlay-subtle p-4 transition hover:border-coral"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="incomplete">Setup</StatusChip>
                    <span className="text-caption text-muted">{labelPickupRunStatus(String(r.status))}</span>
                  </div>
                  <div className="mt-2 text-small font-semibold text-ink">{r.title || "Untitled run"}</div>
                  <p className="mt-1 text-caption text-muted">
                    {!r.final_slot_id ? "Finalize a slot when ready." : "Check outreach and pipeline."}
                  </p>
                </Link>
              ))}

            {guidancePending === 0 && draftLike.length === 0 && incompleteRuns.length === 0 ? (
              <p className="text-small text-muted sm:col-span-2 lg:col-span-3">No urgent pickup or guidance items.</p>
            ) : null}
          </div>
        </section>

        {/* Live + upcoming */}
        <section className="mb-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-line bg-overlay-subtle p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-caption font-semibold text-muted">Pickup hub</div>
              {currentRunRes.data ? (
                <StatusChip tone="published">On hub</StatusChip>
              ) : (
                <StatusChip tone="incomplete">Not linked</StatusChip>
              )}
            </div>
            {currentRunRes.data ? (
              <>
                <div className="text-h3 font-serif font-semibold text-ink">{currentRunRes.data.title || "Run"}</div>
                <div className="text-small text-muted">
                  {labelPickupRunStatus(String(currentRunRes.data.status))}
                  {currentRunRes.data.start_at ? ` · ${fmt(currentRunRes.data.start_at)}` : ""}
                </div>
              </>
            ) : (
              <p className="text-small text-muted">Promote a run so the pickup hub and RSVPs use it.</p>
            )}
            <div className="flex flex-wrap gap-3 pt-1 text-small">
              <Link href="/admin/pickup" className="text-ink underline-offset-4 hover:underline">
                Manage pickups
              </Link>
              <Link href="/pickup" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview hub ↗
              </Link>
            </div>
          </div>

          <div className="rounded-card border border-line bg-overlay-subtle p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-caption font-semibold text-muted">Tournament hub</div>
              {activeTournamentRes.data ? (
                <StatusChip tone="published">Live</StatusChip>
              ) : (
                <StatusChip tone="draft">None live</StatusChip>
              )}
            </div>
            {activeTournamentRes.data ? (
              <>
                <div className="text-h3 font-serif font-semibold text-ink">{activeTournamentRes.data.title}</div>
                <div className="text-small text-muted">URL name: {activeTournamentRes.data.slug || "—"}</div>
              </>
            ) : (
              <p className="text-small text-muted">
                {(tournamentsCountRes.count ?? 0) > 0
                  ? "Mark a tournament live so the public hub shows it."
                  : "Create a tournament before players can see one."}
              </p>
            )}
            <div className="flex flex-wrap gap-3 pt-1 text-small">
              <Link href="/admin/tournament" className="text-ink underline-offset-4 hover:underline">
                Manage tournaments
              </Link>
              <Link href="/tournament" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview hub ↗
              </Link>
            </div>
          </div>
        </section>

        {/* Unified publish */}
        <section className="mb-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-caption font-semibold text-muted">Publish from the dashboard</div>
              <p className="mt-1 max-w-xl text-small text-muted">
                Same composer as{"  "}
                <Link href="/admin/publish" className="text-ink underline-offset-4 hover:underline">
                  Publish
                </Link>
                . Multi-run targets and previews live on that page under “Advanced”.
                {publishLayerMissing
                  ? " Full delivery logging appears after the staff publish migration is applied."
                  : " Each destination is logged and cache refresh runs after you publish."}
              </p>
            </div>
            <Link
              href="/admin/sync"
              className="shrink-0 rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Sync &amp; retries
            </Link>
          </div>
          {!publishLayerMissing ? (
            <div className="flex flex-wrap items-center gap-3 text-caption text-muted">
              {lastPub ? (
                <span>
                  Last logged publish: <span className="text-muted">{clip(lastPub.message, 80)}</span> ·{"  "}
                  {fmt(lastPub.created_at)}
                </span>
              ) : (
                <span>No publishes logged yet.</span>
              )}
            </div>
          ) : (
            <p className="text-caption text-coral">
              Full publish logging isn’t on yet — updates still save, but you won’t see per-page delivery history here. Your
              developer can enable it with the latest staff database migration.
            </p>
          )}
          <StaffPublishPanel
            pickupRuns={publishRuns}
            defaultRunId={currentRunRes.data?.id ?? null}
            hasActiveTournament={!!activeTournamentRes.data?.id}
            publishLayerOk={publishLayerOk}
          />
        </section>

        {/* Content + sync snapshot */}
        <section className="mb-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-line bg-overlay-subtle p-5 space-y-3">
            <div className="text-caption font-semibold text-muted">Site-wide status copy</div>
            <div className="flex flex-wrap gap-2">
              {statusDraft ? <StatusChip tone="draft">Empty announcement</StatusChip> : null}
              {statusScheduled ? <StatusChip tone="scheduled">Next update scheduled</StatusChip> : null}
              {!statusDraft ? <StatusChip tone="published">Has announcement</StatusChip> : null}
            </div>
            <p className="text-small text-muted">{clip(statusRes.data?.announcement, 200) || "—"}</p>
            <div className="text-caption text-muted">Status phase: {statusRes.data?.phase || "—"}</div>
            <div className="flex flex-wrap gap-3 text-small pt-1">
              <Link href="/admin/content" className="text-ink underline-offset-4 hover:underline">
                Content workflow
              </Link>
              <Link href="/admin/status" className="text-muted hover:text-ink underline-offset-4 hover:underline">
                Edit status fields
              </Link>
              <Link href="/status/pickup" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview ↗
              </Link>
            </div>
          </div>

          <div className="rounded-card border border-line bg-overlay-subtle p-5 space-y-3">
            <div className="text-caption font-semibold text-muted">Pickup auto-pipeline</div>
            {pendingSyncRows.length ? (
              <StatusChip tone="pending">Checkpoints due or waiting</StatusChip>
            ) : (
              <StatusChip tone="synced">Nothing urgent in sampled runs</StatusChip>
            )}
            <ul className="space-y-2 text-small text-muted">
              {syncSummaries.slice(0, 4).map((s) => (
                <li key={s.id} className="border-b border-line pb-2 last:border-0">
                  <span className="font-medium text-ink">{s.title}</span>
                  <div className="text-caption text-muted mt-0.5">{clip(s.next_step, 120)}</div>
                </li>
              ))}
            </ul>
            <Link href="/admin/sync" className="inline-block text-small text-ink underline-offset-4 hover:underline">
              Open sync &amp; status
            </Link>
          </div>
        </section>

        {/* Upcoming */}
        <section className="mb-10 rounded-card border border-line bg-overlay-subtle p-5 space-y-4">
          <div className="text-caption font-semibold text-muted">Upcoming kickoffs (pickup)</div>
          {upcomingPickups.length === 0 ? (
            <p className="text-small text-muted">No upcoming kickoffs on recent runs.</p>
          ) : (
            <ul className="divide-line text-small">
              {upcomingPickups.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-ink">{r.title}</span>
                  <span className="text-muted">{fmt(r.start_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <RecentOperatorActivity lines={recentLines} />
        </section>

        {/* Quick actions */}
        <section className="rounded-card border border-line bg-overlay-subtle p-5">
          <div className="text-caption font-semibold text-muted mb-3">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/pickup"
              className="rounded-button bg-pitch px-4 py-2 text-caption font-semibold text-on-pitch hover:opacity-90"
            >
              New or manage pickup
            </Link>
            <Link
              href="/admin/tournament"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Tournament signups
            </Link>
            <Link
              href="/admin/publish"
              className="rounded-button bg-pitch px-4 py-2 text-caption font-semibold text-on-pitch hover:opacity-90"
            >
              Publish
            </Link>
            <Link
              href="/admin/content"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Content
            </Link>
            <Link
              href="/admin/relationships"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Check links
            </Link>
            <Link
              href="/admin/settings"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Settings
            </Link>
          </div>
        </section>
      </AdminWorkArea>
    </main>
  );
}
