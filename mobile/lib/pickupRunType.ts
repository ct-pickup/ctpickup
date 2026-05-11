/**
 * Mirrors `lib/pickup/pickupRunType.ts` (mobile app path alias cannot reach repo `lib/`).
 * Only `select` is invite/restricted; everything else is open signup.
 */
export function isSelectPickupRunType(runType: unknown): boolean {
  return String(runType ?? "").trim().toLowerCase() === "select";
}

export function isPublicPickupRunType(runType: unknown): boolean {
  return !isSelectPickupRunType(runType);
}
