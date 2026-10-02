import Link from "next/link";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { StatusChip } from "@/components/admin/StatusChip";
import { collectPublicEnvHealth, collectServerEnvHealth } from "@/lib/admin/envHealth";
import { APP_HOME_URL } from "@/lib/siteNav";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  const publicEnv = collectPublicEnvHealth();
  const serverEnv = collectServerEnvHealth();

  return (
    <main className="min-h-screen text-ink">
      <PageTop flush title="Staff · Settings" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="What required configuration is present, and where do you manage waivers and compliance?">
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-card border border-line bg-overlay-subtle p-5 space-y-4">
            <h2 className="text-caption font-semibold text-muted">Public / build-time env</h2>
            <ul className="space-y-2">
              {publicEnv.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-2 text-small">
                  <span className="font-mono text-caption text-ink">{f.key}</span>
                  {f.ok ? <StatusChip tone="synced">OK</StatusChip> : <StatusChip tone="failed">Missing</StatusChip>}
                  {f.hint ? <p className="w-full text-caption text-muted">{f.hint}</p> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-line bg-overlay-subtle p-5 space-y-4">
            <h2 className="text-caption font-semibold text-muted">Server-only env</h2>
            <ul className="space-y-2">
              {serverEnv.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-2 text-small">
                  <span className="font-mono text-caption text-ink">{f.key}</span>
                  {f.ok ? <StatusChip tone="synced">Set</StatusChip> : <StatusChip tone="incomplete">Unset</StatusChip>}
                  {f.hint ? <p className="w-full text-caption text-muted">{f.hint}</p> : null}
                </li>
              ))}
            </ul>
            <p className="text-caption text-muted">
              Values are never shown here — only whether they exist. Stripe keys are checked when someone checks out or a
              payment notification arrives.
            </p>
          </section>
        </div>

        <section className="mt-8 rounded-card border border-line bg-overlay-subtle p-5 space-y-3">
          <h2 className="text-small font-semibold text-ink">Staff tools</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/waivers"
              className="rounded-button bg-pitch px-4 py-2 text-caption font-semibold text-on-pitch hover:opacity-90"
            >
              Waivers &amp; acceptances
            </Link>
            <Link
              href="/admin/relationships"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Public link map
            </Link>
            <Link
              href="/admin/sync"
              className="rounded-button border border-line px-4 py-2 text-caption font-semibold text-ink hover:bg-overlay"
            >
              Sync &amp; checkpoints
            </Link>
          </div>
        </section>
      </AdminWorkArea>
    </main>
  );
}
