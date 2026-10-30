import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { approveSuggestion, rejectSuggestion } from "@/lib/fields/suggestionApprove";
import { notifyVenueChange } from "@/lib/alerts/fieldAlerts";
import { markClosedUntil, mergeInto, movePin, removeField, resolveReport, restoreField, distinctReporters, type ActionResult } from "@/lib/fields/venueReports";
import { supabaseService } from "@/lib/supabase/service";

/** Tells players who saved this field that it was removed or closed (their "Changes and cancellations" alert). Never throws. */
async function tellSavers(a: ReturnType<typeof supabaseService>, venueKey: string, res: ActionResult, change: "removed" | "closed", until?: string | null): Promise<void> {
  if (!res.ok || res.fields.length === 0) return;
  if (change === "removed" && !res.fields.includes("status")) return;
  if (change === "closed" && !res.fields.includes("closed_until")) return;
  const { data } = await a.from("venues").select("name").eq("venue_key", venueKey).maybeSingle();
  await notifyVenueChange(a, venueKey, (data as { name?: string } | null)?.name ?? "A saved field", change, until);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * GET /api/admin/venue-suggestions?status=pending|approved|rejected
 * Player suggestions, newest first, with the venue name and the player's name. Admin only (checked here on the server).
 */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = supabaseService();

  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
  const { data, error } = await admin.from("venue_suggestions").select("*").eq("status", status).order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: "Could not load suggestions." }, { status: 500 });
  const rows = (data ?? []) as { id: string; user_id: string; venue_key: string | null; duplicate_of?: string | null }[];

  const venueKeys = [...new Set(rows.map((r) => r.venue_key).filter((k): k is string => !!k))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [venues, profiles, pending] = await Promise.all([
    venueKeys.length ? admin.from("venues").select("venue_key,name,address,price_text,permit_type,setting").in("venue_key", venueKeys) : { data: [] },
    userIds.length ? admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds) : { data: [] },
    admin.from("venue_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const vMap = new Map(((venues.data ?? []) as { venue_key: string }[]).map((v) => [v.venue_key, v]));
  const pMap = new Map(((profiles.data ?? []) as { id: string }[]).map((p) => [p.id, p]));

  // Fields hidden after repeated reports, waiting for Restore / Remove.
  const { data: hiddenRows } = await admin.from("venues").select("venue_key,name,address,status_reason,status_changed_at").eq("status", "hidden_pending_review").limit(100);
  const hiddenKeys = ((hiddenRows ?? []) as { venue_key: string }[]).map((h) => h.venue_key);
  const { data: hiddenReports } = hiddenKeys.length ? await admin.from("venue_suggestions").select("venue_key,user_id,problem,status,note").in("venue_key", hiddenKeys) : { data: [] };
  const reports = (hiddenReports ?? []) as { venue_key: string; user_id: string; problem: string; status: string; note: string | null }[];
  const hidden = ((hiddenRows ?? []) as { venue_key: string }[]).map((h) => ({
    ...h,
    players: distinctReporters(reports.filter((r) => r.venue_key === h.venue_key)),
    notes: reports.filter((r) => r.venue_key === h.venue_key && r.note).map((r) => r.note).slice(0, 5),
  }));
  // Names of the "duplicate of" targets.
  const dupKeys = [...new Set(rows.map((r) => (r as { duplicate_of?: string | null }).duplicate_of).filter((k): k is string => !!k))];
  const { data: dupVenues } = dupKeys.length ? await admin.from("venues").select("venue_key,name,address").in("venue_key", dupKeys) : { data: [] };
  const dMap = new Map(((dupVenues ?? []) as { venue_key: string }[]).map((v) => [v.venue_key, v]));

  return NextResponse.json({
    ok: true,
    pending: pending.count ?? 0,
    hidden,
    items: rows.map((r) => {
      const p = pMap.get(r.user_id) as { first_name?: string | null; last_name?: string | null; username?: string | null } | undefined;
      return { ...r, duplicate: r.duplicate_of ? (dMap.get(r.duplicate_of) ?? null) : null, venue: r.venue_key ? (vMap.get(r.venue_key) ?? null) : null, suggested_by: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.username || "Player" };
    }),
  });
}

/**
 * POST /api/admin/venue-suggestions  { id, action: "approve" | "reject" }
 * approve: a new field creates a venues row (source player, never overwritten by an import); a correction updates the venue and
 * protects the changed values. reject: marks it rejected. Both are safe to repeat.
 */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  const venueKeyBody = typeof body.venue_key === "string" ? body.venue_key : "";
  const REPORT_ACTIONS = ["remove_field", "merge", "move_pin", "close_until"];
  const VENUE_ACTIONS = ["restore", "remove"];
  if (typeof action === "string" && VENUE_ACTIONS.includes(action)) {
    if (!venueKeyBody) return NextResponse.json({ error: "venue_key is required." }, { status: 400 });
    const a = supabaseService();
    try {
      const res = action === "restore" ? await restoreField(a, venueKeyBody, guard.userId) : await removeField(a, venueKeyBody, guard.userId);
      if (action === "remove") await tellSavers(a, venueKeyBody, res, "removed");
      return actionResponse(res);
    } catch (e) {
      console.error("[api/admin/venue-suggestions] failed", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "We couldn’t apply that. Please try again." }, { status: 500 });
    }
  }
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (typeof action === "string" && REPORT_ACTIONS.includes(action)) {
    const a = supabaseService();
    try {
      const { data: sug } = await a.from("venue_suggestions").select("id,status,venue_key,lat,lon,duplicate_of").eq("id", id).maybeSingle();
      const s0 = sug as { id: string; status: string; venue_key: string | null; lat: number | null; lon: number | null; duplicate_of: string | null } | null;
      if (!s0) return NextResponse.json({ error: "Suggestion not found." }, { status: 404 });
      if (!s0.venue_key) return NextResponse.json({ error: "This suggestion is not about an existing field." }, { status: 400 });
      let res: ActionResult;
      if (action === "remove_field") res = await removeField(a, s0.venue_key, guard.userId, "Removed after a player report");
      else if (action === "merge") res = s0.duplicate_of ? await mergeInto(a, s0.venue_key, s0.duplicate_of, guard.userId) : { ok: false, error: "target_missing" };
      else if (action === "move_pin") res = await movePin(a, s0.venue_key, s0.lat, s0.lon, guard.userId);
      else res = await markClosedUntil(a, s0.venue_key, typeof body.until === "string" ? body.until : "", typeof body.reason === "string" ? body.reason : null, guard.userId);
      if (res.ok && s0.status === "pending") await resolveReport(a, id, guard.userId);
      if (action === "remove_field") await tellSavers(a, s0.venue_key, res, "removed");
      if (action === "close_until") await tellSavers(a, s0.venue_key, res, "closed", typeof body.until === "string" ? body.until : null);
      return actionResponse(res);
    } catch (e) {
      console.error("[api/admin/venue-suggestions] failed", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "We couldn’t apply that. Please try again." }, { status: 500 });
    }
  }
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const admin = supabaseService();
  try {
    const result = action === "approve" ? await approveSuggestion(admin, id, guard.userId) : await rejectSuggestion(admin, id, guard.userId);
    if (result === "missing") return NextResponse.json({ error: "Suggestion not found." }, { status: 404 });
    if (result === "venue_missing") return NextResponse.json({ error: "The field this is about no longer exists." }, { status: 409 });
    if (result === "already") return NextResponse.json({ error: "Someone already handled this suggestion.", code: "already" }, { status: 409 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[api/admin/venue-suggestions] failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t apply that. Please try again." }, { status: 500 });
  }
}

function actionResponse(res: ActionResult) {
  if (res.ok) return NextResponse.json({ ok: true, fields: res.fields });
  const msg: Record<string, string> = {
    venue_missing: "That field no longer exists.",
    target_missing: "The other field no longer exists.",
    target_inactive: "The other field is hidden or removed. Restore it first.",
    same_venue: "A field can\u2019t be merged into itself.",
    bad_date: "The date must look like 2026-10-15.",
    no_location: "This report has no pin location.",
  };
  return NextResponse.json({ error: msg[res.error] ?? "We couldn\u2019t apply that." }, { status: res.error === "venue_missing" || res.error === "target_missing" ? 404 : 400 });
}
