import { NextResponse } from "next/server";

import { fetchAdminUserIds } from "@/lib/push/adminUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { requireAuthedUser } from "@/lib/referral/auth";
import { checkPersistentRateLimit, rateLimitResponse } from "@/lib/server/persistentRateLimit";
import { adminNewRequestPush, draftEmail, formatRequestWhen } from "@/shared/fields/requestEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "field-requests";
const REQUESTS_PER_HOUR = 5;
const MAX_DAYS_AHEAD = 120;
const DEFAULT_HOURS = 2;

const ALLOWED_TIMES = new Set(["09:00", "11:00", "13:00", "18:00"]);

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole-hours price from the venue row. Null when the venue is paid with no per-hour price: the admin confirms it. */
function estimateCents(v: { price_status: string | null; price_min: number | null; price_unit: string | null }, hours: number): number | null {
  if (v.price_status === "free") return 0;
  const unit = (v.price_unit ?? "").trim().toLowerCase();
  if (v.price_status === "paid" && v.price_min != null && (unit === "hour" || unit === "hr" || unit === "h")) {
    return Math.round(Number(v.price_min) * 100 * hours);
  }
  return null;
}

/**
 * POST /api/fields/requests
 * A player asks for a field on a date and time. Saves a venue_requests row (status "new"), stores a draft email for the
 * admin, and pushes the admins. Nothing is ever emailed to a school from here: the admin sends that by hand.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limited = await checkPersistentRateLimit({ route: ROUTE, ip: auth.user.id, limit: REQUESTS_PER_HOUR, windowSeconds: 3600 });
  if (!limited.ok) return rateLimitResponse(limited.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const venueKey = typeof body.venue_key === "string" ? body.venue_key.trim() : "";
  const date = typeof body.requested_date === "string" ? body.requested_date.trim() : "";
  const start = typeof body.start_time === "string" ? body.start_time.trim().slice(0, 5) : "";
  const players = Number(body.players);
  const hours = body.duration_hours == null ? DEFAULT_HOURS : Number(body.duration_hours);

  if (!venueKey) return NextResponse.json({ error: "Pick a field." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= todayUtcIso() || date > addDaysIso(todayUtcIso(), MAX_DAYS_AHEAD)) {
    return NextResponse.json({ error: "Pick a day in the next few months." }, { status: 400 });
  }
  if (!ALLOWED_TIMES.has(start)) return NextResponse.json({ error: "Pick a start time." }, { status: 400 });
  if (!Number.isInteger(players) || players < 1 || players > 100) {
    return NextResponse.json({ error: "Players must be between 1 and 100." }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8) return NextResponse.json({ error: "Pick a length up to 8 hours." }, { status: 400 });

  const { data: venue, error: venueErr } = await auth.admin
    .from("venues")
    .select("venue_key,name,venue_type,price_status,price_min,price_unit")
    .eq("venue_key", venueKey)
    .maybeSingle();
  if (venueErr) return NextResponse.json({ error: "We couldn't load that field. Please try again." }, { status: 500 });
  if (!venue) return NextResponse.json({ error: "That field isn't available yet." }, { status: 404 });

  const { data: dupe } = await auth.admin
    .from("venue_requests")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("venue_key", venueKey)
    .eq("requested_date", date)
    .eq("start_time", `${start}:00`)
    .in("status", ["new", "waiting_on_school", "approved"])
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({ error: "You already asked for this field at that time.", code: "duplicate", id: (dupe as { id: string }).id }, { status: 409 });
  }

  const kind = String(venue.venue_type ?? "").startsWith("school") ? "school" : "venue";
  const draft = draftEmail({ venueName: venue.name, venueKind: kind, date, start, hours, players });

  const { data: row, error: insErr } = await auth.admin
    .from("venue_requests")
    .insert({
      user_id: auth.user.id,
      venue_key: venueKey,
      requested_date: date,
      start_time: `${start}:00`,
      duration_hours: hours,
      players,
      estimate_cents: estimateCents(venue, hours),
      draft_email: `${draft.subject}\n\n${draft.body}`,
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json({ error: "You already asked for this field at that time.", code: "duplicate" }, { status: 409 });
    }
    if (/venue_request_rate_limit/.test(insErr.message ?? "")) {
      return NextResponse.json({ error: "You've sent a lot of requests today. Try again tomorrow.", code: "rate_limited" }, { status: 429 });
    }
    console.error(`[api/${ROUTE}] insert failed`, insErr.message);
    return NextResponse.json({ error: "We couldn't send your request. Please try again." }, { status: 500 });
  }

  // Tell the admins. A push failure never fails the request: it is saved and shows in the admin queue.
  try {
    const admins = await fetchAdminUserIds(auth.admin);
    if ("ids" in admins && admins.ids.length > 0) {
      const { data: prof } = await auth.admin.from("profiles").select("first_name,last_name,username").eq("id", auth.user.id).maybeSingle();
      const p = prof as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
      const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.username || "A player";
      const msg = adminNewRequestPush(name, venue.name, formatRequestWhen(date, start, hours), players);
      await sendPushToUsers(auth.admin, admins.ids, { ...msg, data: { screen: "admin/field-requests", request_id: (row as { id: string }).id } });
    }
  } catch (e) {
    console.error(`[api/${ROUTE}] admin push failed`, e);
  }

  return NextResponse.json({ ok: true, id: (row as { id: string }).id });
}
