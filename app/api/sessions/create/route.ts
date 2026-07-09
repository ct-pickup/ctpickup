import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

const ALLOWED_FORMATS = ["5v5", "6v6", "7v7", "Open"];
const ALLOWED_TIERS = ["bronze", "silver", "gold", "platinum", "diamond"];
const ALLOWED_CAPACITIES = [6, 8, 10, 12, 14, 16];

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("approved, first_name, last_name, service_region")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile?.approved) {
    return NextResponse.json({ error: "Your account must be approved to host sessions." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

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

  const min_tier_raw = body.min_tier == null ? null : String(body.min_tier).trim().toLowerCase();
  const min_tier = min_tier_raw && ALLOWED_TIERS.includes(min_tier_raw) ? min_tier_raw : null;

  const fee_cents = Math.max(0, Math.round(Number(body.fee_cents ?? 0)));
  if (fee_cents > 50000) return NextResponse.json({ error: "fee_cents cannot exceed $500." }, { status: 400 });

  const invite_only = body.invite_only === true;

  const service_region = String(profile.service_region ?? "CT").toUpperCase();
  const host_name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Host";
  const title = `${host_name}'s ${format} Session`;

  const now = new Date().toISOString();

  const { data: run, error: insertErr } = await admin
    .from("pickup_runs")
    .insert({
      title,
      location_text,
      start_at: start_at.toISOString(),
      capacity,
      spots_taken: 0,
      level: min_tier,
      fee_cents,
      status: "planning",
      run_type: invite_only ? "select" : "public",
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
