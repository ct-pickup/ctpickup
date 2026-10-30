import { NextResponse } from "next/server";
import { approvedUserIdsInRunServiceRegion } from "@/lib/pickup/pickupPushNotifications";
import {
  promotePlanningRunsPastStart,
  scheduleSessionRateRemindersForRun,
} from "@/lib/pickup/sessionLifecycle";
import { etDateKey, fmtPickupSlotChipEt } from "@/lib/pickup/runStartAtDisplay";
import { parseMinStar, tierBandForStar, writeWithOptionalMinStar } from "@/lib/pickup/minStar";
import { writeWithOptionalTimeTbd } from "@/lib/pickup/runTimeTbd";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { pickupStartFromHostBody } from "@/lib/datetime/easternWallTime";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { profilePhotoGate } from "@/lib/profilePhoto/requirement";
import { resolveGameLink } from "@/lib/fields/gameAtField";
import { requireFlag } from "@/lib/flags";
import { notifyNewGame } from "@/lib/alerts/fieldAlerts";
import { notifyFollowersOfHostRun } from "@/lib/pickup/notifyFollowersOfHostRun";
import { inviteFromPreviousGame, playAgainInfo } from "@/lib/pickup/playAgain";
import { resolveDriveTimeDestination } from "@/lib/venueDistance";

const ALLOWED_FORMATS = ["5v5", "6v6", "7v7", "Open"];

const TIER_MAP: Record<string, { level: string; open_tier_rank: number }> = {
  all:      { level: "casual",      open_tier_rank: 0 },
  bronze:   { level: "casual",      open_tier_rank: 1 },
  silver:   { level: "casual",      open_tier_rank: 2 },
  gold:     { level: "competitive", open_tier_rank: 3 },
  platinum: { level: "competitive", open_tier_rank: 4 },
  diamond:  { level: "elite",       open_tier_rank: 5 },
};

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("approved, is_admin, first_name, last_name, nearest_venue")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || (!profile?.approved && !profile?.is_admin)) {
    return NextResponse.json({ error: "Your account must be approved to host sessions." }, { status: 403 });
  }

  // Admins hosting here play in the session too, so they need a photo like anyone else.
  const photoBlock = await profilePhotoGate(admin, req, { userId: user.id });
  if (photoBlock) return photoBlock;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const location_text = String(body.location_text ?? "").trim();
  if (!location_text) return NextResponse.json({ error: "location_text is required." }, { status: 400 });

  if (!String(body.start_date ?? body.start_at ?? "").trim()) {
    return NextResponse.json({ error: "start_date or start_at is required." }, { status: 400 });
  }
  const kickoff = pickupStartFromHostBody(body);
  if (!kickoff) return NextResponse.json({ error: "Invalid start date or time." }, { status: 400 });
  const { start_at, time_tbd } = kickoff;
  if (time_tbd ? etDateKey(start_at)! < etDateKey(Date.now())! : Date.parse(start_at) < Date.now()) {
    return NextResponse.json({ error: "start_at must be in the future." }, { status: 400 });
  }

  const capacity = Number(body.capacity ?? 10);
  if (!Number.isInteger(capacity) || capacity < 4 || capacity > 30) {
    return NextResponse.json({ error: "capacity must be a whole number between 4 and 30." }, { status: 400 });
  }

  const format = String(body.format ?? "Open").trim();
  if (!ALLOWED_FORMATS.includes(format)) {
    return NextResponse.json({ error: `format must be one of: ${ALLOWED_FORMATS.join(", ")}` }, { status: 400 });
  }

  // min_star (a half star, 0.5 to 5.0) is the exact minimum. When it is sent, min_tier / open_tier_rank are set to the
  // band that contains it (so older app builds read the game correctly) and win over any min_tier in the body.
  const minStarParsed = parseMinStar(body.min_star);
  if (!minStarParsed.ok) return NextResponse.json({ error: minStarParsed.error }, { status: 400 });
  const min_star = minStarParsed.value;

  const min_tier_raw = String(body.min_tier ?? "all").trim().toLowerCase();
  const band = min_star != null ? tierBandForStar(min_star) : null;
  const tierConfig = band ? { level: band.level, open_tier_rank: band.open_tier_rank } : (TIER_MAP[min_tier_raw] ?? TIER_MAP["all"]!);

  const fee_cents = Math.max(0, Math.round(Number(body.fee_cents ?? 0)));
  if (fee_cents > 50000) return NextResponse.json({ error: "fee_cents cannot exceed $500." }, { status: 400 });

  const invite_only = body.invite_only === true;
  let latitude = body.latitude != null ? Number(body.latitude) : null;
  let longitude = body.longitude != null ? Number(body.longitude) : null;

  // A game created from a field (and maybe an approved request) needs the 'fields' flag. Games without a field are not affected.
  if (body.venue_key || body.venue_request_id) {
    const off = await requireFlag(admin, "fields", user.id);
    if (off) return off;
  }
  // Check the field and the request before anything is written.
  const link = await resolveGameLink(admin, user.id, { venue_key: body.venue_key as string | null, venue_request_id: body.venue_request_id as string | null }, etDateKey(start_at)!);
  if (!link.ok) return NextResponse.json({ error: link.error, code: link.code }, { status: link.status });
  if (link.venue) {
    if (latitude == null && typeof link.venue.lat === "number") latitude = link.venue.lat;
    if (longitude == null && typeof link.venue.lon === "number") longitude = link.venue.lon;
  }

  // A repeat of an earlier game: host only, behind the 'play_again' flag, checked before anything is written.
  const repeatOf = typeof body.repeat_of === "string" && /^[0-9a-f-]{36}$/i.test(body.repeat_of) ? body.repeat_of : null;
  if (repeatOf) {
    const off = await requireFlag(admin, "play_again", user.id);
    if (off) return off;
    const info = await playAgainInfo(admin, repeatOf, user.id);
    if (!info || info.role !== "host") {
      return NextResponse.json({ error: "Only the host of that game can run it again.", code: "not_host" }, { status: 403 });
    }
  }

  const service_region = serviceRegionForVenueName(profile.nearest_venue ?? "") ?? "CT";
  const host_name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Host";
  const title = `${host_name}'s ${format} Session`;
  const now = new Date().toISOString();

  const { data: run, error: insertErr } = await writeWithOptionalTimeTbd((withTimeTbd) => writeWithOptionalMinStar((withMinStar) => admin
    .from("pickup_runs")
    .insert({
      title,
      location_text,
      latitude,
      longitude,
      start_at,
      ...(withTimeTbd ? { time_tbd } : {}),
      ...(withMinStar && min_star != null ? { min_star } : {}),
      capacity,
      spots_taken: 0,
      level: tierConfig.level,
      open_tier_rank: tierConfig.open_tier_rank,
      fee_cents,
      status: "planning",
      run_type: invite_only ? "select" : "public",
      format,
      tiered_pricing: body.tiered_pricing === true,
      service_region,
      created_by: user.id,
      // Only sent for games created from a field, so every other game is written exactly as before.
      ...(link.venue_key ? { venue_key: link.venue_key, ...(link.request ? { venue_request_id: link.request.id as string } : {}) } : {}),
      is_current: false,
      auto_managed: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle()));

  if (insertErr?.code === "23505" && link.request) {
    return NextResponse.json({ error: "A game was already created from this request.", code: "already_used" }, { status: 409 });
  }
  if (insertErr || !run) {
    console.error("[sessions/create] insert error", insertErr);
    return NextResponse.json({ error: insertErr?.message ?? "Failed to create session." }, { status: 500 });
  }

  // If kickoff already passed (shouldn't for new creates), flip planning → active.
  // Also queue rate-reminder pushes for any confirmed attendees (host joins later via RSVP).
  try {
    await promotePlanningRunsPastStart(admin, { runId: run.id });
    await scheduleSessionRateRemindersForRun(admin, run.id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sessions/create] lifecycle hooks failed:", msg);
  }

  // Players from the game being repeated hear first, personally. They are then left out of the general pushes below.
  const firstLook = repeatOf
    ? new Set(await inviteFromPreviousGame(admin, { sourceRunId: repeatOf, hostId: user.id, hostName: host_name, newRun: { id: run.id, start_at, time_tbd }, inviteOnly: invite_only }))
    : new Set<string>();

  // Followers of this host (behind the 'host_follow_alerts' flag, 1 per follower per host per day). They are left out of the general pushes.
  const followed = new Set(
    await notifyFollowersOfHostRun(admin, { hostId: user.id, hostName: host_name, run: { id: run.id, start_at, time_tbd, inviteOnly: invite_only, region: service_region }, skip: firstLook }),
  );

  // Public sessions: notify nearby approved players (exclude host).
  // Invite-only sessions stay quiet — invitees get push from /api/sessions/invite.
  if (!invite_only) {
    let regionRecipients: string[] = [];
    try {
      const recipientIds = (
        await approvedUserIdsInRunServiceRegion(admin, service_region, {
          serviceRegion: service_region,
          locationPrivate: location_text,
        })
      ).filter((id) => id !== user.id && !firstLook.has(id) && !followed.has(id));
      regionRecipients = recipientIds;

      if (recipientIds.length > 0) {
        await sendPushToUsers(admin, recipientIds, {
          title: "New session posted 🏃",
          body: `${host_name} posted a ${format} session on ${fmtPickupSlotChipEt(start_at, time_tbd)} in ${service_region}`,
          data: {
            kind: "session_new",
            screen: `session/${run.id}`,
            run_id: run.id,
            url: `ctpickup://session/${run.id}`,
          },
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sessions/create] region push failed:", msg);
    }

    // "New games near me" Fields alert: players inside their own radius who the region push did not already reach.
    // Rate limited, de-duplicated and gated by the 'fields' flag inside notifyNewGame; it never throws.
    const dest = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : resolveDriveTimeDestination({ locationPrivate: location_text, serviceRegion: service_region });
    await notifyNewGame(
      admin,
      { id: run.id, hostId: user.id, startAt: start_at, timeTbd: time_tbd, place: location_text, lat: dest?.lat ?? null, lng: dest?.lng ?? null },
      [...regionRecipients, ...firstLook, ...followed],
    );
  }

  return NextResponse.json({ ok: true, run_id: run.id });
}
