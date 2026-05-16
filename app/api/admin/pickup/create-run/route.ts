import { NextResponse } from "next/server";
import { normalizePickupRunTypeForDb } from "@/lib/pickup/pickupRunType";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

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

  const b = await req.json().catch(() => ({}));

  const startAtRaw = String(b.start_at || "").trim();
  if (!startAtRaw) return NextResponse.json({ error: "start_at required" }, { status: 400 });
  const parsedMs = Date.parse(startAtRaw);
  if (!Number.isFinite(parsedMs)) {
    return NextResponse.json({ error: "Invalid start_at datetime" }, { status: 400 });
  }
  const start_at = new Date(parsedMs).toISOString();

  const regionRaw = b.service_region != null ? String(b.service_region).trim().toUpperCase() : "";
  const service_region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;

  const titleRaw = b.title != null ? String(b.title).trim() : "";
  const title = titleRaw || "CT Pickup Run";
  const run_type = normalizePickupRunTypeForDb(b.run_type);
  const capacity = Number(b.capacity ?? 24);
  const fee_cents = Number(b.fee_cents ?? 0);
  const admin_fee_cents = Math.round(Number(b.admin_fee_cents ?? 0));
  const currency = String(b.currency || "usd");

  if (!Number.isFinite(admin_fee_cents) || admin_fee_cents < 0) {
    return NextResponse.json({ error: "Invalid admin_fee_cents" }, { status: 400 });
  }

  const location_private =
    b.location_private != null && String(b.location_private).trim()
      ? String(b.location_private)
      : b.location_text != null && String(b.location_text).trim()
        ? String(b.location_text)
        : null;

  const show_location_to_confirmed_only = b.show_location_to_confirmed_only !== false;

  const now = new Date().toISOString();

  const insert = await supabaseAdmin
    .from("pickup_runs")
    .insert({
      title,
      run_type,
      is_current: false,
      status: "planning",
      start_at,
      capacity,
      fee_cents,
      admin_fee_cents,
      currency,
      location_private,
      show_location_to_confirmed_only,
      cancellation_deadline: b.cancellation_deadline || null,
      invite_phase: 0,
      phase_opened_at: now,
      created_by: user.id,
      service_region,
      outreach_started_at: null,
      wave1_started_at: null,
      open_tier_rank: null,
      final_slot_id: null,
      auto_managed: false,
      updated_at: now,
    })
    .select("*")
    .single();

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

  const runRow = insert.data as { id: string };
  const slotIns = await supabaseAdmin.from("pickup_run_time_slots").insert({
    run_id: runRow.id,
    start_at,
    label: null,
  });
  if (slotIns.error) {
    console.error("[admin/pickup/create-run] slot insert failed", slotIns.error);
    return NextResponse.json({ error: slotIns.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, run: insert.data });
}
