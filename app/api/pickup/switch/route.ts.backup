import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendTwilioSms } from "@/lib/sms/twilio";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Finds the GMT offset for America/New_York at a given Date (returns like "-05:00" or "-04:00")
function nyOffsetFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const tz = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  // tz is like "GMT-5" or "GMT-4"
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return "-05:00";
  const sign = m[1] === "-" ? "-" : "+";
  const hh = pad2(Number(m[2]));
  const mm = pad2(Number(m[3] || "0"));
  return `${sign}${hh}:${mm}`;
}

function nyYMD(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return { y: y || "2000", m: m || "01", d: d || "01" };
}

// 10:00 PM America/New_York the night before start_at
function computeCancellationDeadline(startAtISO: string) {
  const start = new Date(startAtISO);
  const { y, m, d } = nyYMD(start);
  const off = nyOffsetFor(start);

  // start day at 22:00 local, then minus 24h to get night before
  const startDayAt2200 = new Date(`${y}-${m}-${d}T22:00:00${off}`);
  const cutoff = new Date(startDayAt2200.getTime() - 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

async function requireAdmin(req: Request) {
  const token = bearer(req);
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const u = await admin.auth.getUser(token);
  const userId = u.data.user?.id || null;
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const prof = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!prof.data?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId, token };
}

// GET: returns runs list + optional detail (?run_id=...)
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const url = new URL(req.url);
  const run_id = url.searchParams.get("run_id");

  const runsRes = await admin
    .from("pickup_runs")
    .select("id,title,status,start_at,created_at,run_type,capacity,fee_cents,currency,open_tier_rank,wave1_started_at,likely_on_slot_id,final_slot_id")
    .neq("status", "canceled")
    .order("created_at", { ascending: false });

  const runs = runsRes.data || [];

  if (!run_id) return NextResponse.json({ runs });

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  const run = runRes.data;

  const slotsRes = await admin
    .from("pickup_run_time_slots")
    .select("id,run_id,start_at,label,created_at")
    .eq("run_id", run_id)
    .order("start_at");

  const slots = slotsRes.data || [];

  const availRes = await admin
  .from("pickup_run_availability")
  .select("user_id,slot_id,state,updated_at")
  .eq("run_id", run_id);

  const availability = availRes.data || [];

  const inviteRes = await admin
    .from("pickup_run_invites")
    .select("user_id,invited_at")
    .eq("run_id", run_id);

  const invites = inviteRes.data || [];

  const rsvpRes = await admin
    .from("pickup_run_rsvps")
    .select("user_id,status,updated_at")
    .eq("run_id", run_id);

  const rsvps = rsvpRes.data || [];

  const updateGlobal = await admin
    .from("pickup_run_updates")
    .select("id,run_id,message,created_at,created_by")
    .is("run_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const updateRun = await admin
    .from("pickup_run_updates")
    .select("id,run_id,message,created_at,created_by")
    .eq("run_id", run_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const counts = {
    invites: invites.length,
    available: availability.filter((a) => a.state === "available").length,
    declined: availability.filter((a) => a.state === "declined").length,
    confirmed: rsvps.filter((r) => r.status === "confirmed").length,
    standby: rsvps.filter((r) => r.status === "standby").length,
    pending_payment: rsvps.filter((r) => r.status === "pending_payment").length,
  };

  return NextResponse.json({
    runs,
    run,
    slots,
    availability,
    invites,
    rsvps,
    updates: {
      global: updateGlobal.data?.[0] || null,
      run: updateRun.data?.[0] || null,
    },
    counts,
  });
}

type Action =
  | "create_run"
  | "add_slot"
  | "open_wave1"
  | "finalize_slot"
  | "edit_run"
  | "post_update"
  | "cancel_run";

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "") as Action;

  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  // 1) Create run (planning, start_at null, open_tier_rank null)
  if (action === "create_run") {
    const title = String(body.title || "CT Pickup Run");
    const run_type = String(body.run_type || "select"); // select | public
    const capacity = Number(body.capacity || 18);
    const fee_cents = Number(body.fee_cents || 0);
    const currency = String(body.currency || "usd");
    const location_private = body.location_private ? String(body.location_private) : null;
    const show_location_to_confirmed_only = body.show_location_to_confirmed_only !== false;

    const ins = await admin.from("pickup_runs").insert({
      title,
      run_type,
      status: "planning",
      start_at: null,
      capacity,
      fee_cents,
      currency,
      location_private,
      show_location_to_confirmed_only,
      open_tier_rank: null, // MUST be null initially
      wave1_started_at: null,
      likely_on_at: null,
      likely_on_slot_id: null,
      final_slot_id: null,
      created_by: guard.userId,
      updated_at: new Date().toISOString(),
    }).select("id").maybeSingle();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, run_id: ins.data?.id });
  }

  // 2) Add slot
  if (action === "add_slot") {
    const run_id = String(body.run_id || "");
    const start_at = String(body.start_at || "");
    const label = body.label ? String(body.label) : null;

    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!start_at) return NextResponse.json({ error: "Missing start_at" }, { status: 400 });

    const ins = await admin.from("pickup_run_time_slots").insert({
      run_id,
      start_at,
      label,
    }).select("id").maybeSingle();

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, slot_id: ins.data?.id });
  }

  // 3) Open Wave 1 (Tier 1A + 1B)
  if (action === "open_wave1") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    // set open_tier_rank=2 and wave1_started_at
    const now = new Date().toISOString();
    const up = await admin.from("pickup_runs").update({
      open_tier_rank: 2,
      wave1_started_at: now,
      updated_at: now,
    }).eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    // invite Tier 1A/1B approved users (tier_rank 1,2)
    const ppl = await admin
      .from("profiles")
      .select("id,tier_rank,approved,instagram,phone")
      .in("tier_rank", [1, 2])
      .eq("approved", true);

    const invitedPlayers = (ppl.data || []).map((p) => ({
  user_id: p.id,
  tier_rank: p.tier_rank ?? 6,
  instagram: p.instagram || null,
  phone: p.phone || null,
}));

const rows = invitedPlayers.map((p) => ({
  run_id,
  user_id: p.user_id,
  wave: 1,
  invited_tier_rank: p.tier_rank,
  invited_at: now,
}));

if (rows.length) {
  const existingRes = await admin
    .from("pickup_run_invites")
    .select("user_id")
    .eq("run_id", run_id);

  if (existingRes.error) {
    return NextResponse.json({ error: existingRes.error.message }, { status: 500 });
  }

  const existingUserIds = new Set((existingRes.data || []).map((r) => r.user_id));
  const newRows = rows.filter((r) => !existingUserIds.has(r.user_id));

  if (newRows.length) {
    const inviteInsert = await admin.from("pickup_run_invites").insert(newRows);
    if (inviteInsert.error) {
      return NextResponse.json({ error: inviteInsert.error.message }, { status: 500 });
    }
  }
}

const runDateOrTbd = body.date_or_tbd
  ? String(body.date_or_tbd)
  : "TBD";

const runLink = body.run_link
  ? String(body.run_link)
  : "/pickup";

const handles = invitedPlayers
  .map((p) => p.instagram)
  .filter(Boolean);

const dm_template = `Hey — we’re looking to put together a CT Pickup run for ${runDateOrTbd}.\n\nPlease check the website for all details, updates, and to submit your availability:\n${runLink}\n\nThis invite was sent to Tier 1 players first and is an automated message.`;

const smsTargets = invitedPlayers.filter((p) => p.phone);

const smsResults = await Promise.all(
  smsTargets.map(async (p) => {
    const result = await sendTwilioSms(p.phone as string, dm_template);
    return {
      user_id: p.user_id,
      phone: p.phone,
      ok: result.ok,
      error: result.ok ? null : result.error,
    };
  })
);

const smsSent = smsResults.filter((r) => r.ok).length;
const smsFailed = smsResults.filter((r) => !r.ok).length;

return NextResponse.json({
  ok: true,
  invited: rows.length,
  handles,
  dm_template,
  sms_sent: smsSent,
  sms_failed: smsFailed,
});
  }

  // 4) Finalize slot (admin manual)
  if (action === "finalize_slot") {
    const run_id = String(body.run_id || "");
    const slot_id = String(body.slot_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!slot_id) return NextResponse.json({ error: "Missing slot_id" }, { status: 400 });

    const slotRes = await admin
      .from("pickup_run_time_slots")
      .select("id,start_at")
      .eq("id", slot_id)
      .maybeSingle();

    const slot = slotRes.data;
    if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

    const cancellation_deadline = computeCancellationDeadline(slot.start_at);

    const up = await admin
      .from("pickup_runs")
      .update({
        final_slot_id: slot_id,
        start_at: slot.start_at,
        status: "active",
        cancellation_deadline,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  // 5) Edit run fields (safe edit)
  if (action === "edit_run") {
    const run_id = String(body.run_id || "");
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const patch: any = { updated_at: new Date().toISOString() };
    if (body.title != null) patch.title = String(body.title);
    if (body.capacity != null) patch.capacity = Number(body.capacity);
    if (body.fee_cents != null) patch.fee_cents = Number(body.fee_cents);
    if (body.currency != null) patch.currency = String(body.currency);
    if (body.location_private != null) patch.location_private = String(body.location_private);
    if (body.show_location_to_confirmed_only != null)
      patch.show_location_to_confirmed_only = !!body.show_location_to_confirmed_only;

    const up = await admin.from("pickup_runs").update(patch).eq("id", run_id);
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  // 6) Post update (global if run_id null)
  if (action === "post_update") {
    const run_id = body.run_id ? String(body.run_id) : null;
    const message = String(body.message || "").trim();
    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });

    const ins = await admin.from("pickup_run_updates").insert({
      run_id,
      message,
      created_by: guard.userId,
    });

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // 7) Cancel run
  if (action === "cancel_run") {
    const run_id = String(body.run_id || "");
    const reason = body.reason ? String(body.reason) : null;
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const up = await admin.from("pickup_runs").update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", run_id);

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}