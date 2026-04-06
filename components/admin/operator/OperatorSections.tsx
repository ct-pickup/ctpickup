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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
      <span className="text-white/50">{label}</span>
      <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
      <span className="text-white/85 min-w-0 truncate max-w-[min(100%,28rem)]">{title}</span>
      <Link
        href={previewHref}
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 text-xs text-white/55 hover:text-white"
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
        className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
      >
        Publish update
      </Link>
      {previewPaths.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
        >
          {p.label} ↗
        </Link>
      ))}
      <Link href={syncHref} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
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
    <section className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</div>
      {body ? (
        <>
          <p className="mt-2 text-sm text-white/85 whitespace-pre-wrap line-clamp-4">{body}</p>
          {at ? <div className="mt-1 text-xs text-white/45">{at}</div> : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-white/50">{empty}</p>
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
    <section className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Where this appears</div>
      {tablesMissing ? (
        <p className="mt-2 text-xs text-amber-200/90">
          Publish delivery tracking isn’t set up yet — your developer needs to apply the latest staff database update.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-white/45">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3">Place</th>
                <th className="py-2 pr-3">URL</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-white/5 align-top">
                  <td className="py-2 pr-3 text-white/90">{r.label}</td>
                  <td className="py-2 pr-3 text-xs text-white/55 font-mono">{r.path}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={stateTone(r.state)} title={r.state}>
                        {labelOperatorSurfaceState(r.state)}
                      </StatusChip>
                    </div>
                    <p className="mt-1 text-xs text-white/50">{r.note}</p>
                    {r.lastError ? <p className="mt-1 text-xs text-red-200/90">{r.lastError}</p> : null}
                  </td>
                  <td className="py-2 pr-0 text-right">
                    {r.failedDeliveryId ? (
                      <form action={retryDeliveryAction}>
                        <input type="hidden" name="delivery_id" value={r.failedDeliveryId} />
                        <button
                          type="submit"
                          className="rounded-md border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10"
                        >
                          Retry delivery
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-white/35">—</span>
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
    <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Next</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/75">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
