import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { approveSuggestion, rejectSuggestion } from "@/lib/fields/suggestionApprove";
import { supabaseService } from "@/lib/supabase/service";

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
  const rows = (data ?? []) as { id: string; user_id: string; venue_key: string | null }[];

  const venueKeys = [...new Set(rows.map((r) => r.venue_key).filter((k): k is string => !!k))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [venues, profiles, pending] = await Promise.all([
    venueKeys.length ? admin.from("venues").select("venue_key,name,address,price_text,permit_type,setting").in("venue_key", venueKeys) : { data: [] },
    userIds.length ? admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds) : { data: [] },
    admin.from("venue_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const vMap = new Map(((venues.data ?? []) as { venue_key: string }[]).map((v) => [v.venue_key, v]));
  const pMap = new Map(((profiles.data ?? []) as { id: string }[]).map((p) => [p.id, p]));

  return NextResponse.json({
    ok: true,
    pending: pending.count ?? 0,
    items: rows.map((r) => {
      const p = pMap.get(r.user_id) as { first_name?: string | null; last_name?: string | null; username?: string | null } | undefined;
      return { ...r, venue: r.venue_key ? (vMap.get(r.venue_key) ?? null) : null, suggested_by: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.username || "Player" };
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
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "action must be approve or reject." }, { status: 400 });

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
