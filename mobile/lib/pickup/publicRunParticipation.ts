import { parseHubRegion } from "@/lib/pickup/hubRegions";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";

export type PublicPickupParticipationContext = {
  approved: boolean;
  nearestVenue?: string | null;
  runServiceRegion?: string | null;
  /** Active hub tab from the client (`?region=` on `/api/pickup/public`). */
  hubRegion?: string | null;
  runType?: unknown;
  /**
   * True when the client requested a specific run (`run_id` on public API or commit body).
   * Matches Runs-tab behavior: if the run is listed for the player, they may use the planning poll.
   */
  explicitRunAccess?: boolean;
};

/**
 * Whether an approved player may use the public-run planning poll / join flow.
 * Keeps venue home-region rules, adds hub-tab parity with `publicRunJoinable` on mobile,
 * and allows explicit run lookups (inline poll / deep links / nearby drive-time listings).
 */
export function playerMayParticipateInPublicPickupRun(
  ctx: PublicPickupParticipationContext,
): boolean {
  if (!ctx.approved) return false;
  if (!isPublicPickupRunType(ctx.runType)) return false;
  if (ctx.explicitRunAccess) return true;
  if (profileMatchesRunServiceRegion(ctx.nearestVenue, ctx.runServiceRegion)) return true;
  const runR = parseHubRegion(ctx.runServiceRegion);
  const hubR = parseHubRegion(ctx.hubRegion);
  if (runR && hubR && runR === hubR) return true;
  return false;
}
