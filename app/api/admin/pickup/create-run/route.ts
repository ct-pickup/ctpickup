import { NextResponse } from "next/server";
import {
  buildPublicPickupTimeSlotsForNextDay,
  publicPickupRunPlaceholderStartAt,
} from "@/lib/pickup/publicRunTimeSlots";
import { isPickupRunDateOnlyStartAt } from "@/lib/pickup/runStartAtDisplay";
import { isPublicPickupRunType, normalizePickupRunTypeForDb } from "@/lib/pickup/pickupRunType";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { clearCurrentPickupRunsInRegion } from "@/lib/pickup/hubPromote";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";
import { DateTime } from "luxon";
import { fmtPickupSlotWindowEt } from "@/lib/pickup/fmtPickupSlotWindowEt";
import { normalizeUsZipDigits } from "@/lib/zipRegion";


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

  const regionRaw = b.service_region != null ? String(b.service_region).trim().toUpperCase() : "";
  const service_region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;

  const titleRaw = b.title != null ? String(b.title).trim() : "";
  const title = titleRaw || "CT Pickup Run";
  const run_type = normalizePickupRunTypeForDb(b.run_type);
  const publicRun = isPublicPickupRunType(run_type);

  let start_at: string;
  let timeSlotsToInsert: { label: string; start_at: string }[] | null = null;

  const TZ = "America/New_York";
  function etDateOnlyMidnightUtcIsoFromSlot(startIso: string): string {
    const dt = DateTime.fromISO(startIso).setZone(TZ);
    const iso = DateTime.utc(dt.year, dt.month, dt.day, 0, 0, 0, 0).toISO();
    if (!iso) throw new Error("Could not derive date-only start_at from time slot.");
    return iso;
  }

  if (publicRun) {
    // Admin can optionally provide time slots for public runs (players vote on kickoff time windows).
    const slotsFromBody: string[] = [];
    if (Array.isArray(b.time_slots)) {
      for (const entry of b.time_slots) {
        const raw = String(entry ?? "").trim();
        if (!raw) continue;
        const parsedMs = Date.parse(raw);
        if (!Number.isFinite(parsedMs)) {
          return NextResponse.json({ error: `Invalid time_slots entry: ${raw}` }, { status: 400 });
        }
        slotsFromBody.push(new Date(parsedMs).toISOString());
      }
    }

    if (slotsFromBody.length > 5) {
      return NextResponse.json({ error: "At most 5 time_slots allowed" }, { status: 400 });
    }

    const startAtRaw = String(b.start_at || "").trim();

    if (slotsFromBody.length > 0) {
      // Anchor kickoff date display to the ET wall-clock day of the first slot.
      start_at = etDateOnlyMidnightUtcIsoFromSlot(slotsFromBody[0]!);
      timeSlotsToInsert = slotsFromBody.map((iso) => ({
        label: fmtPickupSlotWindowEt(iso),
        start_at: iso,
      }));
    } else {
      timeSlotsToInsert = buildPublicPickupTimeSlotsForNextDay().map((slot) => ({
        start_at: slot.start_at,
        label: fmtPickupSlotWindowEt(slot.start_at),
      }));

      if (startAtRaw) {
        if (!isPickupRunDateOnlyStartAt(startAtRaw)) {
          return NextResponse.json(
            { error: "Public planning runs require a date-only start_at (midnight UTC) or omit start_at" },
            { status: 400 },
          );
        }
        const m = startAtRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) {
          return NextResponse.json({ error: "Invalid date-only start_at" }, { status: 400 });
        }
        start_at = `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
      } else {
        start_at = publicPickupRunPlaceholderStartAt();
      }
    }
  } else {
    const slotsFromBody: string[] = [];
    if (Array.isArray(b.time_slots)) {
      for (const entry of b.time_slots) {
        const raw = String(entry ?? "").trim();
        if (!raw) continue;
        const parsedMs = Date.parse(raw);
        if (!Number.isFinite(parsedMs)) {
          return NextResponse.json({ error: `Invalid time_slots entry: ${raw}` }, { status: 400 });
        }
        slotsFromBody.push(new Date(parsedMs).toISOString());
      }
    }
    if (slotsFromBody.length > 5) {
      return NextResponse.json({ error: "At most 5 time_slots allowed" }, { status: 400 });
    }
    if (slotsFromBody.length > 0) {
      start_at = slotsFromBody[0]!;
      timeSlotsToInsert = slotsFromBody.map((iso) => ({
        label: fmtPickupSlotWindowEt(iso),
        start_at: iso,
      }));
    } else {
      const startAtRaw = String(b.start_at || "").trim();
      if (!startAtRaw) {
        return NextResponse.json({ error: "start_at or time_slots required" }, { status: 400 });
      }
      const parsedMs = Date.parse(startAtRaw);
      if (!Number.isFinite(parsedMs)) {
        return NextResponse.json({ error: "Invalid start_at datetime" }, { status: 400 });
      }
      start_at = new Date(parsedMs).toISOString();
      timeSlotsToInsert = [
        {
          label: fmtPickupSlotWindowEt(start_at),
          start_at,
        },
      ];
    }
  }
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

  const venue_zip_code = normalizeUsZipDigits(
    b.venue_zip_code != null ? String(b.venue_zip_code) : null,
  );

  const now = new Date().toISOString();

  const cleared = await clearCurrentPickupRunsInRegion(supabaseAdmin, service_region);
  if (cleared.error) {
    return NextResponse.json({ error: cleared.error }, { status: 500 });
  }

  const insert = await supabaseAdmin
    .from("pickup_runs")
    .insert({
      title,
      run_type,
      is_current: true,
      status: "planning",
      start_at,
      capacity,
      fee_cents,
      admin_fee_cents,
      currency,
      location_private,
      ...(venue_zip_code ? { venue_zip_code } : {}),
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

  if (timeSlotsToInsert && timeSlotsToInsert.length > 0) {
    const slotIns = await supabaseAdmin.from("pickup_run_time_slots").insert(
      timeSlotsToInsert.map((slot) => ({
        run_id: runRow.id,
        start_at: slot.start_at,
        label: slot.label || null,
      })),
    );
    if (slotIns.error) {
      console.error("[admin/pickup/create-run] time slots insert failed", slotIns.error);
      return NextResponse.json({ error: slotIns.error.message }, { status: 500 });
    }
  } else {
    const slotIns = await supabaseAdmin.from("pickup_run_time_slots").insert({
      run_id: runRow.id,
      start_at,
      label: null,
    });
    if (slotIns.error) {
      console.error("[admin/pickup/create-run] slot insert failed", slotIns.error);
      return NextResponse.json({ error: slotIns.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, run: insert.data });
}
