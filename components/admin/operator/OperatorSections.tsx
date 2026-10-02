"use client";

import Link from "next/link";
import { StatusChip } from "@/components/admin/StatusChip";
import type { OperatorSurfaceState, WhereSurfaceRow } from "@/lib/admin/operatorContext";
import { labelOperatorSurfaceState } from "@/lib/admin/staffStatusLabels";
import { retryDeliveryAction } from "@/app/admin/sync/actions";

function stateTone(s: OperatorSurfaceState): "synced" | "pending" | "failed" | "neutral" {
  if (s === "failed") return "failed";
  if (s === "pending") return "pending";
  if (s === "synced") return "synced";
  return "neutral";
}

export function OperatorLiveBar({
  label,
  title,
  chip,
  previewHref,
}: {
  label: string;
  title: string;
  chip: { tone: "published" | "draft" | "incomplete"; text: string };
  previewHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card px-4 py-3 text-small">
      <span className="text-muted">{label}</span>
      <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
      <span className="text-ink min-w-0 truncate max-w-[min(100%,28rem)]">{title}</span>
      <Link
        href={previewHref}
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 text-caption text-muted hover:text-ink"
      >
        Preview ↗
      </Link>
    </div>
  );
}

export function OperatorQuickActions({
  publishHref,
  previewPaths,
  syncHref = "/admin/sync",
}: {
  publishHref: string;
  previewPaths: { href: string; label: string }[];
  syncHref?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={publishHref}
        className="rounded-button bg-pitch px-3 py-2 text-caption font-semibold text-on-pitch hover:opacity-90"
      >
        Publish update
      </Link>
      {previewPaths.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-button border border-line px-3 py-2 text-caption font-semibold text-ink hover:bg-overlay"
        >
          {p.label} ↗
        </Link>
      ))}
      <Link href={syncHref} className="rounded-button border border-line px-3 py-2 text-caption font-semibold text-ink hover:bg-overlay">
        Sync &amp; status
      </Link>
    </div>
  );
}

export function OperatorLatestLine({
  title,
  body,
  at,
  empty,
}: {
  title: string;
  body: string | null;
  at: string | null;
  empty: string;
}) {
  return (
    <section className="rounded-card border border-line bg-card px-4 py-3">
      <div className="text-caption font-semibold text-muted">{title}</div>
      {body ? (
        <>
          <p className="mt-2 text-small text-ink whitespace-pre-wrap line-clamp-4">{body}</p>
          {at ? <div className="mt-1 text-caption text-muted">{at}</div> : null}
        </>
      ) : (
        <p className="mt-2 text-small text-muted">{empty}</p>
      )}
    </section>
  );
}

export function OperatorWhereAppears({
  rows,
  tablesMissing,
}: {
  rows: WhereSurfaceRow[];
  tablesMissing: boolean;
}) {
  return (
    <section className="rounded-card border border-line bg-card px-4 py-3">
      <div className="text-caption font-semibold text-muted">Where this appears</div>
      {tablesMissing ? (
        <p className="mt-2 text-caption text-muted">
          Publish delivery tracking isn’t set up yet — your developer needs to apply the latest staff database update.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-small">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3">Place</th>
                <th className="py-2 pr-3">URL</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line align-top">
                  <td className="py-2 pr-3 text-ink">{r.label}</td>
                  <td className="py-2 pr-3 text-caption text-muted font-mono">{r.path}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={stateTone(r.state)} title={r.state}>
                        {labelOperatorSurfaceState(r.state)}
                      </StatusChip>
                    </div>
                    <p className="mt-1 text-caption text-muted">{r.note}</p>
                    {r.lastError ? <p className="mt-1 text-caption text-coral-text">{r.lastError}</p> : null}
                  </td>
                  <td className="py-2 pr-0 text-right">
                    {r.failedDeliveryId ? (
                      <form action={retryDeliveryAction}>
                        <input type="hidden" name="delivery_id" value={r.failedDeliveryId} />
                        <button
                          type="submit"
                          className="rounded-button border border-line px-2 py-1 text-caption font-semibold text-ink hover:bg-overlay"
                        >
                          Retry delivery
                        </button>
                      </form>
                    ) : (
                      <span className="text-caption text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OperatorNextSteps({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="rounded-card border border-line bg-card px-4 py-3">
      <div className="text-caption font-semibold text-ink">Next</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-small text-muted">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
