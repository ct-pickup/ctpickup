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
  draft: "border-line bg-overlay-subtle text-muted",
  published: "border-pitch bg-pitch-panel text-on-pitch-panel",
  scheduled: "border-line bg-overlay-subtle text-muted",
  synced: "border-pitch bg-pitch-panel text-on-pitch-panel",
  pending: "border-line bg-overlay-subtle text-muted",
  failed: "border-coral bg-overlay-subtle text-coral-text",
  incomplete: "border-line bg-overlay-subtle text-muted",
  neutral: "border-line bg-overlay-subtle text-muted",
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
      className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-micro font-semibold ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}
