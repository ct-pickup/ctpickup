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
    <main className="min-h-screen text-white">
      <PageTop flush title="Staff · Settings" fallbackHref={APP_HOME_URL} />

      <AdminWorkArea question="What required configuration is present, and where do you manage waivers and compliance?">
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">Public / build-time env</h2>
            <ul className="space-y-2">
              {publicEnv.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <span className="font-mono text-xs text-white/80">{f.key}</span>
                  {f.ok ? <StatusChip tone="synced">OK</StatusChip> : <StatusChip tone="failed">Missing</StatusChip>}
                  {f.hint ? <p className="w-full text-xs text-white/45">{f.hint}</p> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">Server-only env</h2>
            <ul className="space-y-2">
              {serverEnv.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <span className="font-mono text-xs text-white/80">{f.key}</span>
                  {f.ok ? <StatusChip tone="synced">Set</StatusChip> : <StatusChip tone="incomplete">Unset</StatusChip>}
                  {f.hint ? <p className="w-full text-xs text-white/45">{f.hint}</p> : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-white/40">
              Values are never shown here — only whether they exist. Stripe keys are checked when someone checks out or a
              payment notification arrives.
            </p>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-white/15 bg-white/[0.05] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Staff tools</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/waivers"
              className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              Waivers &amp; acceptances
            </Link>
            <Link
              href="/admin/relationships"
              className="rounded-lg border border-white/20 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
            >
              Public link map
            </Link>
            <Link
              href="/admin/sync"
              className="rounded-lg border border-white/20 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
            >
              Sync &amp; checkpoints
            </Link>
          </div>
        </section>
      </AdminWorkArea>
    </main>
  );
}
