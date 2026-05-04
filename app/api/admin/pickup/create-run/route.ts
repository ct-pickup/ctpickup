import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json();

  const startAt = String(b.start_at || "");
  if (!startAt) return NextResponse.json({ error: "start_at required" }, { status: 400 });

  const regionRaw = b.service_region != null ? String(b.service_region).trim().toUpperCase() : "";
  const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);
  const service_region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;

  const insert = await supabaseAdmin.from("pickup_runs").insert({
    title: b.title || "CT Pickup Run",
    run_type: b.run_type || "select",
    status: "planning",
    start_at: startAt,
    capacity: Number(b.capacity || 24),
    fee_cents: Number(b.fee_cents || 0),
    currency: "usd",
    location_text: b.location_text || null,
    cancellation_deadline: b.cancellation_deadline || null,
    invite_phase: 0,
    phase_opened_at: new Date().toISOString(),
    created_by: user.id,
    service_region,
  }).select("*").single();

  if (insert.error) {
    const msg = insert.error.message;
    const missingRegionCol =
      /service_region/i.test(msg) && (/schema cache/i.test(msg) || /column/i.test(msg) || /Could not find/i.test(msg));
    return NextResponse.json(
      {
        error: missingRegionCol
          ? `${msg} Apply migration supabase/migrations/20260502130000_pickup_runs_service_region.sql in the Supabase SQL editor, then retry.`
          : msg,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, run: insert.data });
}
