import type { ReactNode } from "react";

export type AdminStatusTone =
  | "draft"
  | "published"
  | "scheduled"
  | "synced"
  | "pending"
  | "failed"
  | "incomplete"
  | "neutral";

const TONE_STYLES: Record<AdminStatusTone, string> = {
  draft: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  published: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
  scheduled: "border-sky-500/35 bg-sky-500/10 text-sky-100",
  synced: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
  pending: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  failed: "border-red-500/40 bg-red-500/10 text-red-100",
  incomplete: "border-orange-500/35 bg-orange-500/10 text-orange-100",
  neutral: "border-white/15 bg-white/[0.06] text-white/70",
};

export function StatusChip({
  tone,
  children,
  title,
}: {
  tone: AdminStatusTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}
