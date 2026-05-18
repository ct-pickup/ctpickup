import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";

export function pickupRunTitleForPush(title: unknown): string {
  return typeof title === "string" && title.trim() ? title.trim() : "this run";
}

/** Approved profiles whose nearest venue matches the run service region. */
export async function approvedUserIdsInRunServiceRegion(
  admin: SupabaseClient,
  service_region: string | null | undefined,
): Promise<string[]> {
  const profRes = await admin.from("profiles").select("id,nearest_venue").eq("approved", true);
  if (profRes.error || !(profRes.data?.length ?? 0)) return [];
  return (profRes.data ?? [])
    .filter((p: { id: string; nearest_venue: string | null }) =>
      profileMatchesRunServiceRegion(p.nearest_venue, service_region),
    )
    .map((p: { id: string }) => p.id);
}

/** Recipients when a slot is finalized: all invitees (select) or in-region approved users (public). */
export async function pickupFinalizeSlotPushRecipientIds(
  admin: SupabaseClient,
  run_id: string,
  run: { run_type: string; service_region?: string | null },
): Promise<string[]> {
  if (isPublicPickupRunType(run.run_type)) {
    return approvedUserIdsInRunServiceRegion(admin, run.service_region);
  }
  const invRes = await admin.from("pickup_run_invites").select("user_id").eq("run_id", run_id);
  if (invRes.error) return [];
  return Array.from(
    new Set(
      (invRes.data ?? [])
        .map((r: { user_id: string }) => r.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
}

export async function sendPickupRsvpConfirmedPush(
  admin: SupabaseClient,
  opts: { userId: string; runId: string; runTitle: string },
): Promise<void> {
  const title = pickupRunTitleForPush(opts.runTitle);
  await sendPushToUsers(admin, [opts.userId], {
    title: "You're in! 🎉",
    body: `Your spot for ${title} is confirmed.`,
    data: { kind: "pickup_rsvp_confirmed", run_id: opts.runId },
  });
}

export async function sendPickupAdminConfirmedPush(
  admin: SupabaseClient,
  opts: { userId: string; runId: string; runTitle: string },
): Promise<void> {
  const title = pickupRunTitleForPush(opts.runTitle);
  await sendPushToUsers(admin, [opts.userId], {
    title: "You're confirmed!",
    body: `Admin confirmed your spot for ${title}.`,
    data: { kind: "pickup_admin_confirmed", run_id: opts.runId },
  });
}

export async function sendPickupFinalizedPush(
  admin: SupabaseClient,
  opts: { userIds: string[]; runId: string },
): Promise<void> {
  if (!opts.userIds.length) return;
  await sendPushToUsers(admin, opts.userIds, {
    title: "Pickup time finalized",
    body: "The kickoff time is set. Open the app to confirm your spot.",
    data: { kind: "pickup_finalized", run_id: opts.runId },
  });
}
