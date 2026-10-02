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
  draft: "border-coral bg-overlay-subtle text-coral",
  published: "border-pitch bg-pitch-soft text-pitch",
  scheduled: "border-line bg-overlay text-muted",
  synced: "border-pitch bg-pitch-soft text-pitch",
  pending: "border-coral bg-overlay-subtle text-coral",
  failed: "border-coral bg-overlay-subtle text-coral",
  incomplete: "border-coral bg-overlay-subtle text-coral",
  neutral: "border-line bg-overlay text-muted",
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
      className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-caption font-semibold${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}
