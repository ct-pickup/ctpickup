import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import type { PickupStandingLevel } from "@/lib/pickup/standing/types";
import { supabaseService } from "@/lib/supabase/service";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

export const runtime = "nodejs";

const STANDING_FILTERS = new Set([
  "all",
  "good",
  "warning",
  "suspended",
  "banned",
  "missing_waiver",
]);

type ListFilter = "all" | "good" | "warning" | "suspended" | "banned" | "missing_waiver";

function parseFilter(raw: string | null): ListFilter {
  const s = (raw || "all").trim().toLowerCase();
  if (STANDING_FILTERS.has(s)) return s as ListFilter;
  return "all";
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  email: string | null;
  tier: string | null;
  approved: boolean | null;
  confirmed_count: number | null;
  attended_count: number | null;
  strike_count: number | null;
};

function matchesQuery(p: ProfileRow, q: string): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  const parts = [
    p.first_name,
    p.last_name,
    p.instagram,
    p.email,
    `${p.first_name || ""} ${p.last_name || ""}`,
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
  return parts.some((t) => t.includes(n));
}

function buildRow(
  p: ProfileRow,
  s: Record<string, unknown> | null,
  waiverOk: boolean,
) {
  const effective = (s?.effective_standing || "good") as PickupStandingLevel;
  const auto = (s?.auto_standing || "good") as PickupStandingLevel;
  const manual = (s?.manual_standing ?? null) as PickupStandingLevel | null;
  const joinOk = (effective === "good" || effective === "warning") && waiverOk;

  const attendanceRate =
    p.confirmed_count && p.confirmed_count > 0
      ? Math.round((Number(p.attended_count || 0) / Number(p.confirmed_count)) * 1000) / 10
      : null;

  return {
    user_id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    instagram: p.instagram,
    tier: p.tier,
    confirmed_count: p.confirmed_count,
    attended_count: p.attended_count,
    strike_count: p.strike_count,
    attendance_rate_pct: attendanceRate,
    waiver_current: waiverOk,
    standing: s
      ? {
          manual_standing: s.manual_standing,
          manual_reason: s.manual_reason,
          staff_notes: s.staff_notes,
          manual_updated_at: s.manual_updated_at,
          auto_standing: s.auto_standing,
          auto_codes: s.auto_codes,
          effective_standing: s.effective_standing,
          pickup_eligible: s.pickup_eligible,
          rollup_no_shows_90d: s.rollup_no_shows_90d,
          rollup_late_cancels_90d: s.rollup_late_cancels_90d,
          rollup_pickup_payment_issues_90d: s.rollup_pickup_payment_issues_90d,
          updated_at: s.updated_at,
        }
      : null,
    effective_standing: effective,
    auto_standing: auto,
    manual_override: manual,
    join_ok: joinOk,
  };
}

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit") || 60)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  const svc = supabaseService();

  const profSelect =
    "id,first_name,last_name,instagram,email,tier,approved,confirmed_count,attended_count,strike_count";

  /** Load waiver set for many users */
  async function waiverSetFor(userIds: string[]) {
    if (!userIds.length) return new Set<string>();
    const { data } = await svc
      .from("user_waiver_acceptance")
      .select("user_id")
      .eq("version", CURRENT_WAIVER_VERSION)
      .in("user_id", userIds);
    return new Set((data || []).map((r) => r.user_id));
  }

  async function standingMapFor(userIds: string[]) {
    if (!userIds.length) return new Map<string, Record<string, unknown>>();
    const { data } = await svc.from("pickup_player_standing").select("*").in("user_id", userIds);
    return new Map((data || []).map((r) => [r.user_id as string, r as Record<string, unknown>]));
  }

  let profs: ProfileRow[] = [];

  if (filter === "warning" || filter === "suspended" || filter === "banned") {
    const { data: stRows, error: stErr } = await svc
      .from("pickup_player_standing")
      .select("*")
      .eq("effective_standing", filter)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (stErr) {
      console.error("[admin/pickup/standing] standing slice", stErr.message);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const ids = (stRows || []).map((r) => r.user_id as string);
    if (!ids.length) {
      return NextResponse.json({
        filter,
        limit,
        offset,
        rows: [],
        currentWaiverVersion: CURRENT_WAIVER_VERSION,
      });
    }

    const { data: pRows, error: pErr } = await svc.from("profiles").select(profSelect).in("id", ids);
    if (pErr) {
      console.error("[admin/pickup/standing] profiles", pErr.message);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const pBy = new Map((pRows || []).map((p) => [(p as ProfileRow).id, p as ProfileRow]));
    const waived = await waiverSetFor(ids);
    const rows = (stRows || [])
      .map((st) => {
        const p = pBy.get(st.user_id as string);
        if (!p) return null;
        if (!matchesQuery(p, q)) return null;
        return buildRow(p, st as Record<string, unknown>, waived.has(p.id));
      })
      .filter(Boolean);

    return NextResponse.json({
      filter,
      limit,
      offset,
      rows,
      currentWaiverVersion: CURRENT_WAIVER_VERSION,
    });
  }

  if (filter === "missing_waiver") {
    const { data: waivedRows } = await svc
      .from("user_waiver_acceptance")
      .select("user_id")
      .eq("version", CURRENT_WAIVER_VERSION);

    const waived = new Set((waivedRows || []).map((r) => r.user_id));

    const { data: allApproved, error: apErr } = await svc
      .from("profiles")
      .select(profSelect)
      .eq("approved", true)
      .order("last_name", { ascending: true, nullsFirst: false })
      .limit(1500);

    if (apErr) {
      console.error("[admin/pickup/standing] approved list", apErr.message);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const missing = (allApproved || [])
      .map((p) => p as ProfileRow)
      .filter((p) => !waived.has(p.id))
      .filter((p) => matchesQuery(p, q));

    const slice = missing.slice(offset, offset + limit);
    const ids = slice.map((p) => p.id);
    const stMap = await standingMapFor(ids);
    const rows = slice.map((p) => buildRow(p, stMap.get(p.id) || null, false));

    return NextResponse.json({
      filter,
      limit,
      offset,
      rows,
      currentWaiverVersion: CURRENT_WAIVER_VERSION,
      total_estimate: missing.length,
    });
  }

  if (filter === "good") {
    const { data: approved, error: apErr } = await svc
      .from("profiles")
      .select(profSelect)
      .eq("approved", true)
      .order("last_name", { ascending: true, nullsFirst: false })
      .limit(1500);

    if (apErr) {
      console.error("[admin/pickup/standing] good filter", apErr.message);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const list = (approved || []) as ProfileRow[];
    const ids = list.map((p) => p.id);
    const [waivedSet, stMap] = await Promise.all([waiverSetFor(ids), standingMapFor(ids)]);

    const goodList = list
      .filter((p) => waivedSet.has(p.id))
      .filter((p) => {
        const s = stMap.get(p.id);
        const eff = (s?.effective_standing as string) || "good";
        return eff === "good";
      })
      .filter((p) => matchesQuery(p, q));

    const slice = goodList.slice(offset, offset + limit);
    const rows = slice.map((p) => buildRow(p, stMap.get(p.id) || null, true));

    return NextResponse.json({
      filter,
      limit,
      offset,
      rows,
      currentWaiverVersion: CURRENT_WAIVER_VERSION,
      total_estimate: goodList.length,
    });
  }

  // filter === "all"
  let profQuery = svc
    .from("profiles")
    .select(profSelect)
    .eq("approved", true)
    .order("last_name", { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const like = `%${esc}%`;
    profQuery = profQuery.or(
      `first_name.ilike.${like},last_name.ilike.${like},instagram.ilike.${like},email.ilike.${like}`,
    );
  }

  const { data: profData, error: pErr } = await profQuery;
  if (pErr) {
    console.error("[admin/pickup/standing] profiles", pErr.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  profs = (profData || []) as ProfileRow[];
  const ids = profs.map((p) => p.id);

  if (!ids.length) {
    return NextResponse.json({
      filter,
      limit,
      offset,
      rows: [],
      currentWaiverVersion: CURRENT_WAIVER_VERSION,
    });
  }

  const [waivedSet, stMap] = await Promise.all([waiverSetFor(ids), standingMapFor(ids)]);

  const rows = profs.map((p) => buildRow(p, stMap.get(p.id) || null, waivedSet.has(p.id)));

  return NextResponse.json({
    filter,
    limit,
    offset,
    rows,
    currentWaiverVersion: CURRENT_WAIVER_VERSION,
  });
}

type PatchBody = {
  user_id?: string;
  manual_standing?: PickupStandingLevel | null | "";
  manual_reason?: string | null;
  staff_notes?: string | null;
};

export async function PATCH(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const userId = String(body?.user_id || "").trim();
  if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const manualStanding =
    body?.manual_standing === undefined
      ? undefined
      : body.manual_standing === null || body.manual_standing === ""
        ? null
        : body.manual_standing;

  if (
    manualStanding !== undefined &&
    manualStanding !== null &&
    !["good", "warning", "suspended", "banned"].includes(manualStanding)
  ) {
    return NextResponse.json({ error: "invalid manual_standing" }, { status: 400 });
  }

  const svc = supabaseService();
  const now = new Date().toISOString();

  const { data: exists } = await svc.from("pickup_player_standing").select("user_id").eq("user_id", userId).maybeSingle();

  if (!exists) {
    const ins = await svc.from("pickup_player_standing").insert({ user_id: userId });
    if (ins.error) {
      console.error("[admin/pickup/standing] insert", ins.error.message);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
  }

  let recomputeAfterManual = false;

  if (manualStanding !== undefined) {
    const { data: beforeManual } = await svc
      .from("pickup_player_standing")
      .select("manual_standing")
      .eq("user_id", userId)
      .maybeSingle();

    const prevM = (beforeManual?.manual_standing ?? null) as string | null;
    const manualChanged = prevM !== manualStanding;
    recomputeAfterManual = manualChanged;

    const upd = await svc
      .from("pickup_player_standing")
      .update({
        manual_standing: manualStanding,
        manual_reason: body?.manual_reason ?? null,
        staff_notes: body?.staff_notes ?? null,
        manual_updated_by: gate.userId,
        manual_updated_at: now,
        updated_at: now,
      })
      .eq("user_id", userId);

    if (upd.error) {
      console.error("[admin/pickup/standing] manual update", upd.error.message);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }

    if (manualChanged) {
      await svc.from("pickup_standing_history").insert({
        user_id: userId,
        actor_id: gate.userId,
        event_type: manualStanding === null ? "manual_clear" : "manual_set",
        payload: {
          manual_standing: manualStanding,
          manual_reason: body?.manual_reason ?? null,
          staff_notes: body?.staff_notes ?? null,
        },
      });
    }
  } else if (body?.manual_reason !== undefined || body?.staff_notes !== undefined) {
    const upd = await svc
      .from("pickup_player_standing")
      .update({
        manual_reason: body?.manual_reason ?? null,
        staff_notes: body?.staff_notes ?? null,
        manual_updated_by: gate.userId,
        manual_updated_at: now,
        updated_at: now,
      })
      .eq("user_id", userId);

    if (upd.error) {
      console.error("[admin/pickup/standing] notes update", upd.error.message);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
  }

  if (recomputeAfterManual) {
    try {
      await recomputePickupStandingForUser(svc, userId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[admin/pickup/standing] recompute", msg);
      return NextResponse.json({ error: "recompute_failed" }, { status: 500 });
    }
  }

  const { data: row } = await svc.from("pickup_player_standing").select("*").eq("user_id", userId).maybeSingle();
  return NextResponse.json({ ok: true, standing: row });
}
