"use client";

import Link from "next/link";
import { StatusChip } from "@/components/admin/StatusChip";

export type OperatorEffect = { record: string; detail: string };
export type OperatorVerifyLink = { label: string; href: string };

export function OperatorActionResult({
  ok,
  error,
  hint,
  blocked,
  effects,
  verify,
  messages,
  skipped,
}: {
  ok: boolean;
  error?: string | null;
  hint?: string | null;
  blocked?: boolean;
  effects?: OperatorEffect[];
  verify?: OperatorVerifyLink[];
  messages?: string[];
  skipped?: boolean;
}) {
  if (!ok && error) {
    return (
      <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="failed">Failed</StatusChip>
          {blocked ? <StatusChip tone="incomplete">Blocked</StatusChip> : null}
        </div>
        <p>{error}</p>
        {hint ? <p className="text-xs text-red-200/80">{hint}</p> : null}
      </div>
    );
  }

  if (ok) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="published">{skipped ? "No-op" : "Success"}</StatusChip>
        </div>
        {effects && effects.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80">What changed</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-100/90">
              {effects.map((e, i) => (
                <li key={i}>
                  <span className="font-medium text-white">{e.record}:</span> {e.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {messages && messages.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80">Automation log</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-100/85">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {verify && verify.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80">Open live pages</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {verify.map((v) => (
                <Link
                  key={v.href}
                  href={v.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-100 underline-offset-4 hover:underline"
                >
                  {v.label} ↗
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}
