import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import {
  createDriveMinutesCache,
  filterProfilesByMaxDriveTime,
  type DriveMinutesCache,
  type RunLocationForProximity,
} from "@/lib/pickup/profileMaxDriveFilter";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";

export function pickupRunTitleForPush(title: unknown): string {
  return typeof title === "string" && title.trim() ? title.trim() : "this run";
}

export type RunProximityOpts = RunLocationForProximity & {
  service_region?: string | null;
};

/** Approved profiles within each player's max drive time (or nearest-venue region fallback). */
export async function approvedUserIdsInRunServiceRegion(
  admin: SupabaseClient,
  service_region: string | null | undefined,
  runLocation?: RunProximityOpts | null,
  driveCache?: DriveMinutesCache,
): Promise<string[]> {
  const profRes = await admin
    .from("profiles")
    .select("id,nearest_venue,zip_code,max_drive_minutes")
    .eq("approved", true);
  if (profRes.error || !(profRes.data?.length ?? 0)) return [];

  const cache = driveCache ?? createDriveMinutesCache();
  const withinDrive = await filterProfilesByMaxDriveTime(
    profRes.data ?? [],
    {
      locationPrivate: runLocation?.locationPrivate ?? null,
      serviceRegion: runLocation?.serviceRegion ?? service_region ?? null,
      venue: runLocation?.venue ?? null,
    },
    cache,
  );
  return withinDrive.map((p) => p.id);
}

/** Recipients when a slot is finalized: all invitees (select) or in-region approved users (public). */
export async function pickupFinalizeSlotPushRecipientIds(
  admin: SupabaseClient,
  run_id: string,
  run: { run_type: string; service_region?: string | null; location_private?: string | null },
): Promise<string[]> {
  if (isPublicPickupRunType(run.run_type)) {
    return approvedUserIdsInRunServiceRegion(admin, run.service_region, {
      service_region: run.service_region,
      locationPrivate: run.location_private,
    });
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
    body: "Pickup time is set. Open the app to confirm your spot.",
    data: { kind: "pickup_finalized", run_id: opts.runId },
  });
}

/** Notify approved in-region players when a public run is promoted to the pickup hub. */
export async function sendPickupNewRunPush(
  admin: SupabaseClient,
  opts: {
    runId: string;
    runTitle: string;
    service_region?: string | null;
    location_private?: string | null;
  },
): Promise<void> {
  const driveCache = createDriveMinutesCache();
  const userIds = await approvedUserIdsInRunServiceRegion(
    admin,
    opts.service_region,
    {
      service_region: opts.service_region,
      locationPrivate: opts.location_private,
    },
    driveCache,
  );
  if (!userIds.length) return;
  const title = pickupRunTitleForPush(opts.runTitle);
  await sendPushToUsers(admin, userIds, {
    title: "New pickup run posted 🟢",
    body: `Vote on your availability for the upcoming ${title} run.`,
    data: { kind: "pickup_new_run", run_id: opts.runId },
  });
}

/** Push to players newly invited on a select run wave (wave 1 on hub promote or cron). */
export async function sendPickupInvitePush(
  admin: SupabaseClient,
  opts: {
    userIds: string[];
    runId: string;
    runTitle: string;
    wave?: number;
    emergency?: boolean;
  },
): Promise<void> {
  if (!opts.userIds.length) return;
  const title = pickupRunTitleForPush(opts.runTitle);

  if (opts.emergency) {
    await sendPushToUsers(admin, opts.userIds, {
      title: "Last call — pickup tonight",
      body: "A spot just opened for tonight's run.\n\nConfirm now — run starts in under 2 hours.",
      data: { kind: "pickup_invite", run_id: opts.runId },
    });
    return;
  }

  if (opts.wave === 1) {
    await sendPushToUsers(admin, opts.userIds, {
      title: "You've been invited to a Select Pickup",
      body: "You've been selected for an exclusive pickup run. Open the app for full details and to submit your availability.",
      data: { kind: "pickup_invite", run_id: opts.runId },
    });
    return;
  }

  await sendPushToUsers(admin, opts.userIds, {
    title: "Pickup invite update",
    body: `You've been invited to ${title}. Open the app to see details and submit your availability.`,
    data: { kind: "pickup_invite", run_id: opts.runId },
  });
}

/** Remind prior-wave invitees without an RSVP before the next tier wave opens. */
export async function sendPickupPriorWaveReinvitePush(
  admin: SupabaseClient,
  opts: {
    userIds: string[];
    runId: string;
    runTitle: string;
    priorWave: number;
  },
): Promise<void> {
  if (!opts.userIds.length) return;
  const title = pickupRunTitleForPush(opts.runTitle);
  const tierLabel = opts.priorWave === 1 ? "Tier 1" : `Tier ${opts.priorWave}`;
  await sendPushToUsers(admin, opts.userIds, {
    title: "Still spots available 👋",
    body: `${tierLabel} players — your spot for ${title} is still open. Tap to join.`,
    data: { kind: "pickup_invite", run_id: opts.runId },
  });
}
