import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { PublishComposer } from "@/components/admin/PublishComposer";
import { StaffPublishPanel } from "@/components/admin/StaffPublishPanel";
import { isPublishLayerAvailable } from "@/lib/admin/publishLayer";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminPublishPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; tournament?: string }>;
}) {
  const sp = await searchParams;
  const preselectRunIds = sp.run?.trim() ? [sp.run.trim()] : [];
  const preselectTournament = sp.tournament === "1" || sp.tournament === "true";
  let supabase;
  try {
    supabase = supabaseService();
  } catch {
    return (
      <main className="min-h-screen text-white">
        <PageTop flush title="Staff · Publish" fallbackHref={APP_HOME_URL} />
        <AdminWorkArea question="Where should this one message go — and did it land everywhere you selected?">
          <p className="text-sm text-white/55">Database isn’t configured.</p>
        </AdminWorkArea>
      </main>
    );
  }

  const publishLayerOk = await isPublishLayerAvailable(supabase);

  const [runsRes, promotedRes, activeTRes] = await Promise.all([
    supabase
      .from("pickup_runs")
      .select("id,title,is_current,status")
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("pickup_runs")
      .select("id")
      .eq("is_current", true)
      .neq("status", "canceled")
      .limit(1)
      .maybeSingle(),
    supabase.from("tournaments").select("id").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  const runs = (runsRes.data || []).map((r) => ({
    id: r.id as string,
    title: r.title as string | null,
    is_current: r.is_current as boolean | null,
    status: String(r.status ?? ""),
  }));

  const defaultRunIds = promotedRes.data?.id ? [promotedRes.data.id as string] : [];
  const panelRuns = runs.map((r) => ({
    id: r.id,
    title: r.title,
    is_current: !!r.is_current,
    status: r.status,
  }));

  return (
    <main className="min-h-screen text-white">
      <PageTop flush title="Staff · Publish" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="Where should this update go — site-wide, one pickup run, or both — and did it land?">
        <p className="mb-6 max-w-3xl text-sm text-white/55">
          <strong className="font-medium text-white/80">Data:</strong> site-wide copy lives in{" "}
          <code className="text-white/60">status_updates</code> row <code className="text-white/60">id = 1</code> (
          <code className="text-white/60">announcement</code>). Pickup posts are rows in{" "}
          <code className="text-white/60">pickup_run_updates</code> (<code className="text-white/60">run_id</code> set for a run,
          or <code className="text-white/60">null</code> for “all pickup” under More destinations). One publish can write to
          both tables in a single request. Afterward, paths like <code className="text-white/60">/pickup</code> and{" "}
          <code className="text-white/60">/status/pickup</code> are revalidated so visitors see changes quickly.
        </p>
        <div className="mb-8 flex flex-wrap gap-3 text-sm">
          <Link href="/admin/sync" className="text-white underline-offset-4 hover:underline">
            Sync &amp; status
          </Link>
          <Link href="/admin/content" className="text-white/55 hover:text-white underline-offset-4 hover:underline">
            Content overview
          </Link>
          <Link href="/admin/relationships" className="text-white/55 hover:text-white underline-offset-4 hover:underline">
            Link map
          </Link>
        </div>

        <StaffPublishPanel
          pickupRuns={panelRuns}
          defaultRunId={
            preselectRunIds[0] ||
            (promotedRes.data?.id as string | undefined) ||
            null
          }
          hasActiveTournament={!!activeTRes.data?.id}
          publishLayerOk={publishLayerOk}
        />

        <details className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-medium text-white/85">
            Advanced — multiple runs, preview, extra targets
          </summary>
          <p className="mt-3 max-w-3xl text-xs text-white/50">
            Check several pickup runs at once, preview each destination, or align with a deep-linked tournament flag. Uses the
            same server pipeline as the simple composer above.
          </p>
          <div className="mt-5">
            <PublishComposer
              runs={runs}
              defaultRunIds={defaultRunIds}
              preselectRunIds={preselectRunIds}
              preselectTournament={preselectTournament}
              hasActiveTournament={!!activeTRes.data?.id}
            />
          </div>
        </details>
      </AdminWorkArea>
    </main>
  );
}
