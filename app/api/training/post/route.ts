import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { stateFromUsZipFive } from "@/lib/usZipState";
import { normalizeUsZipDigits } from "@/lib/zipRegion";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type Body = {
  field_name?: string;
  latitude?: number;
  longitude?: number;
  started_at?: string | null;
  training_until?: string | null;
  what_im_working_on?: string | null;
  spots_available?: number;
  notes?: string | null;
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const HUB_STATES = new Set(["CT", "NY", "NJ", "MD"]);

function regionForTrainer(nearestVenue: string | null | undefined, zipCode: string | null | undefined): string | null {
  const fromVenue = serviceRegionForVenueName(nearestVenue);
  if (fromVenue && HUB_STATES.has(fromVenue)) return fromVenue;
  const zip5 = normalizeUsZipDigits(zipCode);
  if (!zip5) return null;
  const fromZip = stateFromUsZipFive(zip5);
  return fromZip && HUB_STATES.has(fromZip) ? fromZip : null;
}

function profileInHubRegion(
  nearestVenue: string | null | undefined,
  zipCode: string | null | undefined,
  region: string,
): boolean {
  const venueRegion = serviceRegionForVenueName(nearestVenue);
  if (venueRegion === region) return true;
  const zip5 = normalizeUsZipDigits(zipCode);
  if (!zip5) return false;
  return stateFromUsZipFive(zip5) === region;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const fieldName = typeof body.field_name === "string" ? body.field_name.trim() : "";
  if (!fieldName) return NextResponse.json({ error: "field_name is required" }, { status: 400 });

  const lat = typeof body.latitude === "number" ? body.latitude : null;
  const lng = typeof body.longitude === "number" ? body.longitude : null;
  if (lat === null || lng === null) {
    return NextResponse.json({ error: "latitude and longitude are required" }, { status: 400 });
  }

  const spots = typeof body.spots_available === "number" ? Math.round(body.spots_available) : 2;
  if (spots < 0 || spots > 5) {
    return NextResponse.json({ error: "spots_available must be between 0 and 5" }, { status: 400 });
  }

  const workingOn =
    typeof body.what_im_working_on === "string" && body.what_im_working_on.trim()
      ? body.what_im_working_on.trim()
      : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const trainingUntil = typeof body.training_until === "string" && body.training_until.trim()
    ? body.training_until
    : null;

  const now = Date.now();
  let startedAtIso = new Date(now).toISOString();
  if (typeof body.started_at === "string" && body.started_at.trim()) {
    const parsed = new Date(body.started_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid started_at." }, { status: 400 });
    }
    const ms = parsed.getTime();
    if (ms > now + 5 * 60 * 1000) {
      return NextResponse.json({ error: "Start time cannot be in the future." }, { status: 400 });
    }
    if (ms < now - TWO_HOURS_MS) {
      return NextResponse.json(
        { error: "Start time can't be more than 2 hours in the past." },
        { status: 400 },
      );
    }
    startedAtIso = parsed.toISOString();
  }

  // Only one active training post per user — end any existing one first.
  await admin
    .from("training_posts")
    .update({ status: "ended", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active");

  const { data, error } = await admin
    .from("training_posts")
    .insert({
      user_id: user.id,
      field_name: fieldName,
      latitude: lat,
      longitude: lng,
      started_at: startedAtIso,
      training_until: trainingUntil,
      what_im_working_on: workingOn,
      spots_available: spots,
      notes,
      status: "active",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create training post" }, { status: 500 });
  }

  // Notify nearby players in the trainer's hub region (CT/NY/NJ/MD) — not everyone.
  try {
    const { data: trainer } = await admin
      .from("profiles")
      .select("first_name,last_name,username,nearest_venue,zip_code")
      .eq("id", user.id)
      .maybeSingle();

    const { data: rating } = await admin
      .from("player_ratings")
      .select("tier")
      .eq("user_id", user.id)
      .maybeSingle();

    const trainerName =
      [trainer?.first_name, trainer?.last_name].filter(Boolean).join(" ") ||
      trainer?.username ||
      "Someone";
    const tier = (rating?.tier ? String(rating.tier) : "bronze").toLowerCase();
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const region = regionForTrainer(trainer?.nearest_venue, trainer?.zip_code);

    if (region) {
      const { data: candidates } = await admin
        .from("profiles")
        .select("id,nearest_venue,zip_code")
        .eq("approved", true)
        .eq("push_notifications_enabled", true)
        .neq("id", user.id);

      const recipientIds = (candidates ?? [])
        .filter((p) => profileInHubRegion(p.nearest_venue, p.zip_code, region))
        .map((p) => p.id as string);

      if (recipientIds.length > 0) {
        const spotsLabel =
          spots <= 0 ? "solo session" : `${spots} spot${spots === 1 ? "" : "s"} open`;
        await sendPushToUsers(admin, recipientIds, {
          title: "Training nearby ⚽",
          body: `${trainerName} (${tierLabel}) is training at ${fieldName} — ${spotsLabel}`,
          data: {
            screen: `training/${data.id}`,
            post_id: data.id,
            url: `ctpickup://training/${data.id}`,
          },
        });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[training/post] region push failed:", msg);
  }

  return NextResponse.json({ ok: true, post_id: data.id });
}
