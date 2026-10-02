import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { PublishComposer } from "@/components/admin/PublishComposer";
import { RecentOperatorActivity } from "@/components/admin/RecentOperatorActivity";
import { StaffPublishPanel } from "@/components/admin/StaffPublishPanel";
import { StatusChip } from "@/components/admin/StatusChip";
import { loadRecentOperatorContext } from "@/lib/admin/recentOperatorContext";
import { isPublishLayerAvailable } from "@/lib/admin/publishLayer";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function clip(s: string | null | undefined, n: number) {
  const t = (s || "").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

export default async function AdminContentPage() {
  let supabase;
  try {
    supabase = supabaseService();
  } catch {
    return (
      <main className="min-h-screen text-ink">
        <PageTop flush title="Staff · Content" fallbackHref={APP_HOME_URL} />
        <AdminWorkArea question="What copy is drafted, scheduled, or live — and where does it surface publicly?">
          <p className="text-small text-muted">Database isn’t configured.</p>
        </AdminWorkArea>
      </main>
    );
  }

  const publishLayerOk = await isPublishLayerAvailable(supabase);

  const [statusRes, globalPostRes, promotedRes, guidanceRes, esportsRes, runsListRes, activeTRes, recentLines] =
    await Promise.all([
      supabase.from("status_updates").select("phase,announcement,next_update_by").eq("id", 1).maybeSingle(),
      supabase
        .from("pickup_run_updates")
        .select("message,created_at")
        .is("run_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("pickup_runs")
        .select("id")
        .eq("is_current", true)
        .neq("status", "canceled")
        .limit(1)
        .maybeSingle(),
      supabase.from("guidance_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("esports_tournaments").select("id", { count: "exact", head: true }),
      supabase
        .from("pickup_runs")
        .select("id,title,status,is_current")
        .neq("status", "canceled")
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("tournaments").select("id").eq("is_active", true).limit(1).maybeSingle(),
      loadRecentOperatorContext(supabase),
    ]);

  const publishRuns = (runsListRes.data || []).map((r) => ({
    id: r.id as string,
    title: r.title as string | null,
    is_current: !!(r as { is_current?: boolean }).is_current,
    status: r.status as string,
  }));
  const defaultRunIds = promotedRes.data?.id ? [promotedRes.data.id as string] : [];

  const status = statusRes.data;
  const announcement = (status?.announcement || "").trim();
  const nu = status?.next_update_by ? new Date(status.next_update_by).getTime() : null;
  const scheduled =
    nu !== null && !Number.isNaN(nu) && nu > new Date().getTime();

  return (
    <main className="min-h-screen text-ink">
      <PageTop flush title="Staff · Content" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="What copy is drafted, scheduled, or live — and where does it surface on pickup, tournament, and status pages?">
        <div className="mb-6 flex flex-wrap gap-3 text-small">
          <Link href="/admin/publish" className="font-semibold text-ink underline-offset-4 hover:underline">
            Full-screen publish
          </Link>
          <Link href="/admin/sync" className="text-muted hover:text-ink underline-offset-4 hover:underline">
            Sync &amp; retries
          </Link>
          <Link href="/admin/relationships" className="text-muted hover:text-ink underline-offset-4 hover:underline">
            Repair hub links
          </Link>
        </div>

        <section className="mb-10 space-y-3">
          <h2 className="text-caption font-semibold text-muted">Publish here</h2>
          <StaffPublishPanel
            pickupRuns={publishRuns}
            defaultRunId={(promotedRes.data?.id as string) ?? null}
            hasActiveTournament={!!activeTRes.data?.id}
            publishLayerOk={publishLayerOk}
          />
          {publishLayerOk ? (
            <details className="rounded-card border border-line bg-card p-4">
              <summary className="cursor-pointer text-small font-medium text-ink">
                Advanced — multi-run &amp; preview
              </summary>
              <div className="mt-4">
                <PublishComposer
                  runs={publishRuns}
                  defaultRunIds={defaultRunIds}
                  hasActiveTournament={!!activeTRes.data?.id}
                />
              </div>
            </details>
          ) : null}
        </section>

        <div className="mb-10">
          <RecentOperatorActivity lines={recentLines} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Site-wide status */}
          <section className="rounded-card border border-line bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-small font-semibold text-ink">Site-wide status card</h2>
              <div className="flex flex-wrap gap-2">
                {!announcement ? <StatusChip tone="draft">Draft</StatusChip> : <StatusChip tone="published">Has copy</StatusChip>}
                {scheduled ? <StatusChip tone="scheduled">Commitment date</StatusChip> : null}
              </div>
            </div>
            <p className="text-caption text-muted">
              Used for help chat and staff tools — not the pickup status feed (that comes from pickup posts below).
            </p>
            <p className="text-small text-muted">{clip(status?.announcement, 280) || "—"}</p>
            <p className="text-caption text-muted">
              Saves apply immediately — visitors see changes on their next load.
            </p>
            <div className="flex flex-wrap gap-3 text-small">
              <Link href="/admin/status" className="font-semibold text-ink underline-offset-4 hover:underline">
                Edit &amp; save
              </Link>
              <Link href="/status/pickup" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview pickup status ↗
              </Link>
              <Link href="/status/tournament" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview tournament status ↗
              </Link>
            </div>
          </section>

          {/* Pickup feed posts */}
          <section className="rounded-card border border-line bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-small font-semibold text-ink">Pickup player posts</h2>
              <StatusChip tone="published">Immediate on send</StatusChip>
            </div>
            <p className="text-caption text-muted">
              Global message or per-run message · appears in pickup feeds players see
            </p>
            <div>
              <div className="text-caption text-muted">Latest global</div>
              <p className="text-small text-ink">{clip(globalPostRes.data?.message, 200) || "—"}</p>
            </div>
            <p className="text-caption text-muted">
              Write in Pickups and send — that’s the publish step. Run-scoped posts go to the hub run (
              {promotedRes.data ? "set" : "not set"}).
            </p>
            <div className="flex flex-wrap gap-3 text-small">
              <Link href="/admin/pickup" className="font-semibold text-ink underline-offset-4 hover:underline">
                Open pickup composer
              </Link>
              <Link href="/pickup" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                Preview hub ↗
              </Link>
            </div>
          </section>

          {/* Program surfaces */}
          <section className="rounded-card border border-line bg-card p-5 space-y-4 lg:col-span-2">
            <h2 className="text-small font-semibold text-ink">Program pages</h2>
            <p className="text-small text-muted">
              These are edited on their own admin tools; they are separate from the status card and pickup posts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-line bg-card p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">Guidance</span>
                  {(guidanceRes.count ?? 0) > 0 ? (
                    <StatusChip tone="pending">{guidanceRes.count} pending</StatusChip>
                  ) : (
                    <StatusChip tone="synced">Inbox clear</StatusChip>
                  )}
                </div>
                <p className="text-caption text-muted">Public guidance page — these are requests, not a static page edit.</p>
                <Link href="/admin/guidance" className="text-small text-ink underline-offset-4 hover:underline">
                  Manage requests
                </Link>
              </div>
              <div className="rounded-card border border-line bg-card p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">Esports</span>
                  <StatusChip tone="neutral">{esportsRes.count ?? 0} listed</StatusChip>
                </div>
                <p className="text-caption text-muted">Public esports listing — shows tournaments marked upcoming or active.</p>
                <Link href="/admin/esports" className="text-small text-ink underline-offset-4 hover:underline">
                  Manage tournaments
                </Link>
              </div>
            </div>
          </section>
        </div>
      </AdminWorkArea>
    </main>
  );
}
