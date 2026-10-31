import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { pushRequestStatus } from "@/lib/fields/requestPush";
import { pushSeasonRefund, refundSeasonForRequest, type SeasonRefundResult } from "@/lib/plans/seasonRefund";
import { supabaseService } from "@/lib/supabase/service";
import { isAdminSettableStatus, type RequestStatus } from "@/shared/fields/requestEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "waiting_on_school", "approved", "declined"] as const;

type RequestRow = {
  id: string;
  user_id: string;
  venue_key: string;
  requested_date: string;
  start_time: string;
  duration_hours: number;
  players: number;
  estimate_cents: number | null;
  status: RequestStatus;
  draft_email: string | null;
  school_contact_email: string | null;
  admin_notes: string | null;
  created_at: string;
  status_changed_at: string;
  plan?: string | null;
  plan_kind?: "free" | "included" | "extra" | "season" | null;
  weeks?: number | null;
};

/**
 * GET /api/admin/field-requests?status=new|waiting_on_school|approved|declined
 * The request queue, newest first, with the venue and the player's name. Admin only (checked here on the server).
 */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = supabaseService();

  const status = new URL(req.url).searchParams.get("status");
  const BASE = "id,user_id,venue_key,requested_date,start_time,duration_hours,players,estimate_cents,status,draft_email,school_contact_email,admin_notes,created_at,status_changed_at";
  const build = (cols: string) => {
    let q = admin.from("venue_requests").select(cols).order("created_at", { ascending: false }).limit(200);
    if (status && (STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
    return q;
  };
  // plan, plan_kind and weeks come from the plans migrations. Before they are applied, read without them.
  let res = await build(`${BASE},plan,plan_kind,weeks`);
  if (res.error) res = await build(`${BASE},plan,plan_kind`);
  if (res.error) res = await build(BASE);
  const { data, error } = res;
  if (error) return NextResponse.json({ error: "Could not load requests." }, { status: 500 });
  const rows = (data ?? []) as unknown as RequestRow[];

  const venueKeys = [...new Set(rows.map((r) => r.venue_key))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [venues, profiles, counts] = await Promise.all([
    venueKeys.length ? admin.from("venues").select("venue_key,name,address,school_name,website,booking_phone").in("venue_key", venueKeys) : { data: [] },
    userIds.length ? admin.from("profiles").select("id,first_name,last_name,username").in("id", userIds) : { data: [] },
    Promise.all(STATUSES.map((s) => admin.from("venue_requests").select("id", { count: "exact", head: true }).eq("status", s))),
  ]);
  const vMap = new Map(((venues.data ?? []) as { venue_key: string }[]).map((v) => [v.venue_key, v]));
  const pMap = new Map(((profiles.data ?? []) as { id: string }[]).map((p) => [p.id, p]));

  return NextResponse.json({
    ok: true,
    counts: Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]?.count ?? 0])),
    items: rows.map((r) => {
      const p = pMap.get(r.user_id) as { first_name?: string | null; last_name?: string | null; username?: string | null } | undefined;
      return {
        ...r,
        venue: vMap.get(r.venue_key) ?? null,
        requested_by: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.username || "Player",
      };
    }),
  });
}

/**
 * PATCH /api/admin/field-requests  { id, status?, school_contact_email?, admin_notes? }
 * Moves a request to waiting_on_school, approved or declined, and pushes the player when the status changes.
 * Never sends email: the admin sends the draft to the school by hand.
 */
export async function PATCH(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = supabaseService();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!isAdminSettableStatus(body.status)) return NextResponse.json({ error: "Status must be waiting_on_school, approved or declined." }, { status: 400 });
    patch.status = body.status;
  }
  if (body.school_contact_email !== undefined) {
    const e = typeof body.school_contact_email === "string" ? body.school_contact_email.trim() : "";
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
    patch.school_contact_email = e || null;
  }
  if (body.admin_notes !== undefined) patch.admin_notes = typeof body.admin_notes === "string" ? body.admin_notes.trim().slice(0, 2000) || null : null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const { data: before, error: readErr } = await admin.from("venue_requests").select("status,user_id,venue_key,requested_date,start_time,duration_hours").eq("id", id).maybeSingle();
  if (readErr) return NextResponse.json({ error: "Could not load the request." }, { status: 500 });
  if (!before) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  const prev = before as { status: RequestStatus; user_id: string; venue_key: string; requested_date: string; start_time: string; duration_hours: number };

  // Declining a paid season refunds it first. If the refund fails, nothing changes and the admin sees why.
  let refund: SeasonRefundResult = { kind: "none" };
  if (patch.status === "declined") {
    refund = await refundSeasonForRequest(admin, id);
    if (refund.kind === "failed") return NextResponse.json({ error: refund.message }, { status: 502 });
  }

  const { error: updErr } = await admin.from("venue_requests").update(patch).eq("id", id);
  if (updErr) return NextResponse.json({ error: refund.kind === "refunded" ? "The season was refunded, but the request could not be updated. Try Decline again." : "Could not update the request." }, { status: 500 });

  if (refund.kind === "refunded") await pushSeasonRefund(admin, id, prev);
  else if (typeof patch.status === "string" && patch.status !== prev.status) await pushRequestStatus(admin, id, prev, patch.status as RequestStatus);

  return NextResponse.json({ ok: true });
}
