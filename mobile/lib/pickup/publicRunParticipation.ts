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

export type PublicPickupParticipationBranch =
  | "not_approved"
  | "not_public_run"
  | "explicit_run_access"
  | "venue_region_match"
  | "hub_tab_match"
  | "denied";

export type PublicPickupParticipationResult = {
  allowed: boolean;
  branch: PublicPickupParticipationBranch;
};

/**
 * Whether an approved player may use the public-run planning poll / join flow.
 * Keeps venue home-region rules, adds hub-tab parity with Runs list filtering,
 * and allows explicit run lookups (inline poll / deep links / nearby drive-time listings).
 */
export function explainPlayerMayParticipateInPublicPickupRun(
  ctx: PublicPickupParticipationContext,
): PublicPickupParticipationResult {
  if (!ctx.approved) return { allowed: false, branch: "not_approved" };
  if (!isPublicPickupRunType(ctx.runType)) return { allowed: false, branch: "not_public_run" };
  if (ctx.explicitRunAccess) return { allowed: true, branch: "explicit_run_access" };
  if (profileMatchesRunServiceRegion(ctx.nearestVenue, ctx.runServiceRegion)) {
    return { allowed: true, branch: "venue_region_match" };
  }
  const runR = parseHubRegion(ctx.runServiceRegion);
  const hubR = parseHubRegion(ctx.hubRegion);
  if (runR && hubR && runR === hubR) return { allowed: true, branch: "hub_tab_match" };
  return { allowed: false, branch: "denied" };
}

export function playerMayParticipateInPublicPickupRun(
  ctx: PublicPickupParticipationContext,
): boolean {
  return explainPlayerMayParticipateInPublicPickupRun(ctx).allowed;
}
