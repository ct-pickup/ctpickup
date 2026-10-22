import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeCalendarUrl, parseIcs } from "@/shared/fields/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const MAX_HOPS = 3;
const MAX_EVENTS = 2000;
const WINDOW_BACK_MS = 86_400_000;
const WINDOW_AHEAD_MS = 60 * 86_400_000;

function isPrivateAddress(addr: string): boolean {
  if (isIP(addr) === 6) {
    const a = addr.toLowerCase();
    return a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:127.") || a.startsWith("::ffff:10.") || a.startsWith("::ffff:192.168.");
  }
  const [a, b] = addr.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a! >= 224;
}

/** Fetches an https calendar, refusing private or local addresses at every redirect hop. */
async function fetchCalendarText(startUrl: string): Promise<string> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("Calendar links must be https.");
    const addrs = await lookup(u.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That calendar address isn't allowed.");
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "text/calendar, text/plain, */*" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The calendar returned HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("The calendar is too large.");
    return text;
  }
  throw new Error("The calendar redirected too many times.");
}

/**
 * POST /api/admin/venue-calendars  { venue_key }
 * Reads the venue's saved calendar link now and updates its sync status and known bookings.
 *  - Success: sync_status "live", and the calendar's events replace this venue's calendar-sourced slots.
 *  - Failure, or a calendar with recurring events (which we cannot read yet): sync_status "failed". The venue then shows
 *    Unknown, never Open, because a booked hour could be hiding in what we couldn't read.
 * Admin only (checked here on the server).
 */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = supabaseService();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const venueKey = typeof body.venue_key === "string" ? body.venue_key : "";
  if (!venueKey) return NextResponse.json({ error: "venue_key is required." }, { status: 400 });

  const { data: cal, error: calErr } = await admin.from("venue_calendars").select("venue_key,calendar_url").eq("venue_key", venueKey).maybeSingle();
  if (calErr) return NextResponse.json({ error: "Could not load the calendar." }, { status: 500 });
  const url = normalizeCalendarUrl((cal as { calendar_url?: string | null } | null)?.calendar_url ?? "");
  if (!cal || !url) return NextResponse.json({ error: "Add a calendar link first." }, { status: 400 });

  const nowIso = new Date().toISOString();
  const fail = async (message: string) => {
    await admin.from("venue_calendars").update({ sync_status: "failed", last_error: message, last_error_at: nowIso }).eq("venue_key", venueKey);
    return NextResponse.json({ ok: false, status: "failed", error: message });
  };

  let text: string;
  try {
    text = await fetchCalendarText(url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "We couldn't read that calendar.");
  }

  const parsed = parseIcs(text);
  if (parsed.recurring > 0) {
    return fail(`This calendar has ${parsed.recurring} repeating events, which we can't read yet. Showing Unknown.`);
  }

  const from = Date.now() - WINDOW_BACK_MS;
  const to = Date.now() + WINDOW_AHEAD_MS;
  const rows = parsed.events
    .filter((e) => e.end.getTime() > from && e.start.getTime() < to)
    .slice(0, MAX_EVENTS)
    .map((e) => ({ venue_key: venueKey, starts_at: e.start.toISOString(), ends_at: e.end.toISOString(), status: "booked", title: e.summary, source: "calendar" }));

  const del = await admin.from("schedule_slots").delete().eq("venue_key", venueKey).eq("source", "calendar").gte("ends_at", new Date(from).toISOString());
  if (del.error) return fail("We couldn't save this calendar's bookings.");
  if (rows.length > 0) {
    const ins = await admin.from("schedule_slots").insert(rows);
    if (ins.error) return fail("We couldn't save this calendar's bookings.");
  }

  await admin
    .from("venue_calendars")
    .update({ sync_status: "live", last_synced_at: nowIso, last_error: null, last_error_at: null, connected_at: nowIso })
    .eq("venue_key", venueKey);
  return NextResponse.json({ ok: true, status: "live", events: rows.length });
}
