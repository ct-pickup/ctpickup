import type { RecentUpdateLine } from "@/lib/admin/recentOperatorContext";

export function RecentOperatorActivity({ lines }: { lines: RecentUpdateLine[] }) {
  if (!lines.length) {
    return (
      <section className="rounded-card border border-line bg-card p-5">
        <h3 className="text-caption font-semibold text-muted">Recent activity</h3>
        <p className="mt-2 text-small text-muted">Nothing recent to show yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-line bg-card p-5">
      <h3 className="text-caption font-semibold text-muted">Recent activity</h3>
      <p className="mt-1 text-caption text-muted">
        From latest posts and edit times — not a full history log.
      </p>
      <ul className="mt-4 divide-line text-small">
        {lines.map((line, i) => (
          <li key={i} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-medium text-ink">{line.label}</div>
              <div className="text-caption text-muted">{line.detail}</div>
            </div>
            {line.at ? <div className="shrink-0 text-caption text-muted">{line.at}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
