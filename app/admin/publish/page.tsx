import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { PublishComposer } from "@/components/admin/PublishComposer";
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
  }));

  const defaultRunIds = promotedRes.data?.id ? [promotedRes.data.id as string] : [];

  return (
    <main className="min-h-screen text-white">
      <PageTop flush title="Staff · Publish" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="Write once, choose every surface that should carry the same message, preview each destination, then publish in a single action.">
        <p className="mb-6 max-w-3xl text-sm text-white/55">
          Sends your message to the pickup posts, site-wide status, and/or live tournament you select, keeps a publish log when
          logging is enabled, and refreshes public pages afterward. Sending the same publish twice won’t duplicate posts.
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

        <PublishComposer
          runs={runs}
          defaultRunIds={defaultRunIds}
          preselectRunIds={preselectRunIds}
          preselectTournament={preselectTournament}
          hasActiveTournament={!!activeTRes.data?.id}
        />
      </AdminWorkArea>
    </main>
  );
}
