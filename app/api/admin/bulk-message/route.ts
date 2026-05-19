import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { truncatePushBody } from "@/lib/push/truncatePushBody";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { venueNamesForServiceRegion } from "@/lib/pickup/venueServiceRegion";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";

export const runtime = "nodejs";


/** Matches `app/api/pickup/public` tier_rank mapping: 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6 */
const TIER_CHIP_TO_RANK: Record<string, number> = {
  "1a": 1,
  "1b": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
};

type BulkFilter = "all" | "region" | "tier" | "run";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeTierChip(raw: string): string | null {
  const k = String(raw || "").trim().toLowerCase();
  if (!k) return null;
  return k in TIER_CHIP_TO_RANK ? k : null;
}

function tierRankFromFilterValue(filterValue: string): number | null {
  const chip = normalizeTierChip(filterValue);
  if (!chip) return null;
  return TIER_CHIP_TO_RANK[chip] ?? null;
}

async function listRecipientIds(
  admin: SupabaseClient,
  filter: BulkFilter,
  filterValue: string | null,
): Promise<string[]> {
  const base = () =>
    admin.from("profiles").select("id").eq("approved", true).eq("is_banned", false).order("id", { ascending: true });

  if (filter === "all") {
    const out: string[] = [];
    const pageSize = 1000;
    let start = 0;
    while (true) {
      const res = await base().range(start, start + pageSize - 1);
      if (res.error) throw new Error(res.error.message);
      const rows = (res.data ?? []) as { id: string }[];
      for (const r of rows) {
        if (r.id) out.push(r.id);
      }
      if (rows.length < pageSize) break;
      start += pageSize;
    }
    return out;
  }

  if (filter === "region") {
    const region = String(filterValue || "").trim().toUpperCase();
    if (!HUB_REGIONS.has(region)) throw new Error("Invalid region");
    const venues = venueNamesForServiceRegion(region);
    if (!venues.length) return [];
    const out: string[] = [];
    const pageSize = 1000;
    let start = 0;
    while (true) {
      const res = await base().in("nearest_venue", venues).range(start, start + pageSize - 1);
      if (res.error) throw new Error(res.error.message);
      const rows = (res.data ?? []) as { id: string }[];
      for (const r of rows) {
        if (r.id) out.push(r.id);
      }
      if (rows.length < pageSize) break;
      start += pageSize;
    }
    return out;
  }

  if (filter === "tier") {
    const rank = tierRankFromFilterValue(String(filterValue || ""));
    if (rank == null) throw new Error("Invalid tier");
    const out: string[] = [];
    const pageSize = 1000;
    let start = 0;
    while (true) {
      const res = await base().eq("tier_rank", rank).range(start, start + pageSize - 1);
      if (res.error) throw new Error(res.error.message);
      const rows = (res.data ?? []) as { id: string }[];
      for (const r of rows) {
        if (r.id) out.push(r.id);
      }
      if (rows.length < pageSize) break;
      start += pageSize;
    }
    return out;
  }

  if (filter === "run") {
    const runId = String(filterValue || "").trim();
    if (!isUuid(runId)) throw new Error("run_id must be a uuid");
    const rsvpRes = await admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", runId)
      .eq("status", "confirmed");
    if (rsvpRes.error) throw new Error(rsvpRes.error.message);
    const raw = [...new Set((rsvpRes.data ?? []).map((x) => String((x as { user_id?: string }).user_id || "")).filter(Boolean))];
    if (!raw.length) return [];
    const out: string[] = [];
    const chunk = 200;
    for (let i = 0; i < raw.length; i += chunk) {
      const slice = raw.slice(i, i + chunk);
      const res = await base().in("id", slice);
      if (res.error) throw new Error(res.error.message);
      for (const r of (res.data ?? []) as { id: string }[]) {
        if (r.id) out.push(r.id);
      }
    }
    return out;
  }

  throw new Error("Invalid filter");
}

async function recipientCount(admin: SupabaseClient, filter: BulkFilter, filterValue: string | null): Promise<number> {
  if (filter === "all") {
    const res = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approved", true)
      .eq("is_banned", false);
    if (res.error) throw new Error(res.error.message);
    return typeof res.count === "number" ? res.count : 0;
  }
  if (filter === "region") {
    const region = String(filterValue || "").trim().toUpperCase();
    if (!HUB_REGIONS.has(region)) throw new Error("Invalid region");
    const venues = venueNamesForServiceRegion(region);
    if (!venues.length) return 0;
    const res = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approved", true)
      .eq("is_banned", false)
      .in("nearest_venue", venues);
    if (res.error) throw new Error(res.error.message);
    return typeof res.count === "number" ? res.count : 0;
  }
  if (filter === "tier") {
    const rank = tierRankFromFilterValue(String(filterValue || ""));
    if (rank == null) throw new Error("Invalid tier");
    const res = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approved", true)
      .eq("is_banned", false)
      .eq("tier_rank", rank);
    if (res.error) throw new Error(res.error.message);
    return typeof res.count === "number" ? res.count : 0;
  }
  if (filter === "run") {
    const runId = String(filterValue || "").trim();
    if (!isUuid(runId)) throw new Error("run_id must be a uuid");
    const rsvpRes = await admin
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", runId)
      .eq("status", "confirmed");
    if (rsvpRes.error) throw new Error(rsvpRes.error.message);
    const raw = [...new Set((rsvpRes.data ?? []).map((x) => String((x as { user_id?: string }).user_id || "")).filter(Boolean))];
    if (!raw.length) return 0;
    let total = 0;
    const chunk = 200;
    for (let i = 0; i < raw.length; i += chunk) {
      const slice = raw.slice(i, i + chunk);
      const res = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("id", slice)
        .eq("approved", true)
        .eq("is_banned", false);
      if (res.error) throw new Error(res.error.message);
      total += typeof res.count === "number" ? res.count : 0;
    }
    return total;
  }
  throw new Error("Invalid filter");
}

function parseFilter(s: string | null): BulkFilter | null {
  const v = String(s || "").trim().toLowerCase();
  if (v === "all" || v === "region" || v === "tier" || v === "run") return v;
  return null;
}

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const filterValueRaw = url.searchParams.get("filter_value");
  const filterValue = filterValueRaw != null && String(filterValueRaw).trim() ? String(filterValueRaw).trim() : null;

  if (!filter) {
    return NextResponse.json({ error: "filter must be all, region, tier, or run" }, { status: 400 });
  }
  if (filter !== "all" && !filterValue) {
    return NextResponse.json({ error: "filter_value required for this filter" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const count = await recipientCount(admin, filter, filterValue);
    return NextResponse.json({ ok: true, count });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

type PostBody = {
  filter?: string;
  filter_value?: string | null;
  message?: string;
};

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as PostBody | null;
  const filter = parseFilter(body?.filter != null ? String(body.filter) : null);
  const filterValue =
    body?.filter_value != null && String(body.filter_value).trim() ? String(body.filter_value).trim() : null;
  const message = String(body?.message ?? "").trim();

  if (!filter) {
    return NextResponse.json({ error: "filter must be all, region, tier, or run" }, { status: 400 });
  }
  if (filter !== "all" && !filterValue) {
    return NextResponse.json({ error: "filter_value required for this filter" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 500) {
    return NextResponse.json({ error: "message must be at most 500 characters" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const userIds = await listRecipientIds(admin, filter, filterValue);
    const unique = [...new Set(userIds)];
    if (!unique.length) {
      return NextResponse.json({ error: "No players match this audience." }, { status: 400 });
    }

    const roomRes = await admin
      .from("chat_rooms")
      .select("id,slug,title,room_type")
      .eq("slug", "announcements")
      .maybeSingle();
    if (roomRes.error) return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
    const room = roomRes.data as { id: string; slug: string; title: string; room_type: string | null } | null;
    if (!room) return NextResponse.json({ error: "announcements room not found" }, { status: 500 });

    const ins = await admin.from("chat_messages").insert({
      room_id: room.id,
      user_id: guard.userId,
      body: message,
    });
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    const pushBody = truncatePushBody(message);
    const push = await sendPushToUsers(admin, unique, {
      title: "CT Pickup",
      body: pushBody,
      data: {
        kind: "announcement",
        room_slug: room.slug,
        room_id: room.id,
        room_type: room.room_type,
      },
    });
    if (push.lookupError) {
      return NextResponse.json({ error: push.lookupError }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent_to: unique.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
