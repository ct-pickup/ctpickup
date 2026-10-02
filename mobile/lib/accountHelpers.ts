export const MIN_MAX_DRIVE_MINUTES = 30;
export const MAX_MAX_DRIVE_MINUTES = 90;
export const DEFAULT_MAX_DRIVE_MINUTES = 50;
export const MAX_DRIVE_STEP = 5;

export function clampMaxDriveMinutes(value: number): number {
  const stepped = Math.round(value / MAX_DRIVE_STEP) * MAX_DRIVE_STEP;
  return Math.min(MAX_MAX_DRIVE_MINUTES, Math.max(MIN_MAX_DRIVE_MINUTES, stepped));
}

export function maxDriveLabel(minutes: number): string {
  if (minutes >= MAX_MAX_DRIVE_MINUTES) return "Up to 90+ min drive";
  return `Up to ${minutes} min drive`;
}

export function supabaseLooksLikeMissingColumn(err: { message?: string } | null | undefined, col: string): boolean {
  const msg = err?.message ?? "";
  if (!msg) return false;
  const re = new RegExp(col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return re.test(msg) && (/column/i.test(msg) || /schema cache/i.test(msg) || /Could not find/i.test(msg));
}

export function cleanInstagram(s: string): string {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export function formatProfileSaveError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const o = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint].filter((s) => typeof s === "string" && s.trim());
    if (parts.length) return parts.join(" — ");
    if (o.code) return `Error code ${o.code}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
