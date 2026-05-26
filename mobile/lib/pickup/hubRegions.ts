/** Hub service regions for pickup / tournament routing (CT, NY, NJ, MD). */
export const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

export function parseHubRegion(param: string | null | undefined): string | null {
  if (!param) return null;
  const u = param.trim().toUpperCase();
  return HUB_REGIONS.has(u) ? u : null;
}
