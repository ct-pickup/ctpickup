import { NextResponse } from "next/server";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

const ALLOWED_FORMATS = ["5v5", "6v6", "7v7", "Open"];
const ALLOWED_CAPACITIES = [6, 8, 10, 12, 14, 16];

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

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const location_text = String(body.location_text ?? "").trim();
  if (!location_text) return NextResponse.json({ error: "location_text is required." }, { status: 400 });

  const start_at_raw = String(body.start_at ?? "").trim();
  if (!start_at_raw) return NextResponse.json({ error: "start_at is required." }, { status: 400 });
  const start_at = new Date(start_at_raw);
  if (isNaN(start_at.getTime())) return NextResponse.json({ error: "Invalid start_at." }, { status: 400 });
  if (start_at < new Date()) return NextResponse.json({ error: "start_at must be in the future." }, { status: 400 });

  const capacity = Number(body.capacity ?? 10);
  if (!ALLOWED_CAPACITIES.includes(capacity)) {
    return NextResponse.json({ error: `capacity must be one of: ${ALLOWED_CAPACITIES.join(", ")}` }, { status: 400 });
  }

  const format = String(body.format ?? "Open").trim();
  if (!ALLOWED_FORMATS.includes(format)) {
    return NextResponse.json({ error: `format must be one of: ${ALLOWED_FORMATS.join(", ")}` }, { status: 400 });
  }

  const min_tier_raw = String(body.min_tier ?? "all").trim().toLowerCase();
  const tierConfig = TIER_MAP[min_tier_raw] ?? TIER_MAP["all"]!;

  const fee_cents = Math.max(0, Math.round(Number(body.fee_cents ?? 0)));
  if (fee_cents > 50000) return NextResponse.json({ error: "fee_cents cannot exceed $500." }, { status: 400 });

  const invite_only = body.invite_only === true;
  const latitude = body.latitude != null ? Number(body.latitude) : null;
  const longitude = body.longitude != null ? Number(body.longitude) : null;

  const service_region = serviceRegionForVenueName(profile.nearest_venue ?? "") ?? "CT";
  const host_name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Host";
  const title = `${host_name}'s ${format} Session`;
  const now = new Date().toISOString();

  const { data: run, error: insertErr } = await admin
    .from("pickup_runs")
    .insert({
      title,
      location_text,
      latitude,
      longitude,
      start_at: start_at.toISOString(),
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
      is_current: false,
      auto_managed: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (insertErr || !run) {
    console.error("[sessions/create] insert error", insertErr);
    return NextResponse.json({ error: insertErr?.message ?? "Failed to create session." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, run_id: run.id });
}
