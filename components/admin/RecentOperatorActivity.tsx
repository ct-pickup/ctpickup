import type { RecentUpdateLine } from "@/lib/admin/recentOperatorContext";

export function RecentOperatorActivity({ lines }: { lines: RecentUpdateLine[] }) {
  if (!lines.length) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Recent activity</h3>
        <p className="mt-2 text-sm text-white/50">Nothing recent to show yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Recent activity</h3>
      <p className="mt-1 text-xs text-white/40">
        From latest posts and edit times — not a full history log.
      </p>
      <ul className="mt-4 divide-y divide-white/10 text-sm">
        {lines.map((line, i) => (
          <li key={i} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-medium text-white/90">{line.label}</div>
              <div className="text-xs text-white/60">{line.detail}</div>
            </div>
            {line.at ? <div className="shrink-0 text-xs text-white/40">{line.at}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
