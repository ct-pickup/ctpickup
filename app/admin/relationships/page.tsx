import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { RelationshipHubPanel } from "@/components/admin/RelationshipHubPanel";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function AdminRelationshipsPage() {
  let supabase;
  try {
    supabase = supabaseService();
  } catch {
    return (
      <main className="min-h-screen text-ink">
        <PageTop flush title="Staff · Relationships" fallbackHref={APP_HOME_URL} />
        <AdminWorkArea question="What is wired together — and what is missing so the public site goes quiet?">
          <p className="text-small text-muted">Database isn’t configured.</p>
        </AdminWorkArea>
      </main>
    );
  }

  const [promotedRes, activeTRes, pickupListRes, tournamentListRes] = await Promise.all([
    supabase
      .from("pickup_runs")
      .select("id,title,status")
      .eq("is_current", true)
      .neq("status", "canceled")
      .limit(1)
      .maybeSingle(),
    supabase.from("tournaments").select("id,title,slug").eq("is_active", true).limit(1).maybeSingle(),
    supabase
      .from("pickup_runs")
      .select("id,title,status")
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("tournaments").select("id,title,is_active").order("title", { ascending: true }).limit(40),
  ]);

  const pickupOptions = pickupListRes.data || [];
  const tournamentOptions = tournamentListRes.data || [];

  const rows = [
    {
      name: "Pickup hub",
      from: "The run promoted to the pickup hub",
      to: "Pickup hub, RSVPs, and pickup status when that run is public",
      ok: !!promotedRes.data,
      fix: "/admin/pickup",
    },
    {
      name: "Tournament hub",
      from: "The tournament marked live",
      to: "Tournament hub and tournament status page",
      ok: !!activeTRes.data,
      fix: "/admin/tournament",
    },
    {
      name: "Site-wide status",
      from: "Main status fields you edit in Site-wide status",
      to: "Help chat context and staff tools (pickup status feed still uses pickup posts)",
      ok: true,
      fix: "/admin/status",
    },
    {
      name: "Pickup posts",
      from: "Pickup posts you send from Pickups or Publish",
      to: "Pickup status page and in-app pickup feeds",
      ok: !!promotedRes.data,
      fix: "/admin/pickup",
    },
    {
      name: "Unified publish",
      from: "Publish with logging enabled",
      to: "One message to several places, with a history of what reached each page",
      ok: true,
      fix: "/admin/publish",
    },
  ];

  return (
    <main className="min-h-screen text-ink">
      <PageTop flush title="Staff · Relationships" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="What is this item connected to, what updates automatically, and what dependency is still missing?">
        <p className="mb-6 max-w-3xl text-small text-muted">
          A few “what’s live” choices power what players see. When one is missing, hubs look empty even if older data exists.
        </p>

        <ul className="space-y-4">
          {rows.map((r) => (
            <li
              key={r.name}
              className="rounded-card border border-line bg-overlay-subtle p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{r.name}</span>
                  {r.ok ? <StatusChip tone="synced">Linked</StatusChip> : <StatusChip tone="incomplete">Gap</StatusChip>}
                </div>
                <div className="text-caption text-muted">
                  <span className="text-muted">What drives it:</span> {r.from}
                </div>
                <div className="text-caption text-muted">
                  <span className="text-muted">Where players see it:</span> {r.to}
                </div>
                {r.name.startsWith("Pickup hub") && promotedRes.data ? (
                  <div className="text-small text-muted pt-1">
                    Current: <span className="text-ink">{promotedRes.data.title}</span> ({promotedRes.data.status})
                  </div>
                ) : null}
                {r.name.startsWith("Tournament") && activeTRes.data ? (
                  <div className="text-small text-muted pt-1">
                    Current: <span className="text-ink">{activeTRes.data.title}</span> · {activeTRes.data.slug}
                  </div>
                ) : null}
              </div>
              <Link
                href={r.fix}
                className="shrink-0 rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>

        <RelationshipHubPanel
          pickupRuns={pickupOptions.map((r) => ({ id: r.id, title: r.title, status: r.status }))}
          tournaments={tournamentOptions.map((t) => ({ id: t.id, title: t.title }))}
          currentPickupId={promotedRes.data?.id ?? null}
          activeTournamentId={activeTRes.data?.id ?? null}
        />

        <section className="mt-10 rounded-card border border-line bg-overlay-subtle p-5">
          <h3 className="text-caption font-semibold text-muted">What updates automatically</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-small text-muted">
            <li>Pickup auto-pipeline checkpoints after you launch outreach and leave automation on.</li>
            <li>Stripe finishes captain payments and pickup holds after checkout.</li>
            <li>Pickup posts and hub changes show up on the next page load for visitors.</li>
          </ul>
        </section>
      </AdminWorkArea>
    </main>
  );
}
