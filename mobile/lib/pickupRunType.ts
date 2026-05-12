/**
 * Mirrors `lib/pickup/pickupRunType.ts` (mobile app uses its own copy for path aliases).
 */
export type PickupRunTypeStored = "select" | "public";

export function normalizePickupRunTypeForDb(raw: unknown): PickupRunTypeStored {
  const t = String(raw ?? "select").trim().toLowerCase();
  return t === "public" ? "public" : "select";
}

export function isPublicPickupRunType(runType: unknown): boolean {
  if (runType == null) return false;
  return String(runType).trim().toLowerCase() === "public";
}

export function isSelectPickupRunType(runType: unknown): boolean {
  return !isPublicPickupRunType(runType);
}
