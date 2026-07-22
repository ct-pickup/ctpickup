import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

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

  return NextResponse.json({ ok: true, post_id: data.id });
}
