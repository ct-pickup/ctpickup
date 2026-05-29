import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import type { PickupStandingLevel } from "@/lib/pickup/standing/types";
import { computePickupReliability } from "@/lib/pickup/standing/reliabilityScore";
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

function supabaseErrorJson(err: unknown) {
  if (!err || typeof err !== "object") return { error: "load_failed" };
  const e = err as Record<string, unknown>;
  const message =
    typeof e.message === "string" && e.message.trim() ? e.message.trim() : "load_failed";
  return {
    error: message,
    code: typeof e.code === "string" ? e.code : undefined,
    details: typeof e.details === "string" ? e.details : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
  };
}

function unknownErrorJson(err: unknown) {
  if (err instanceof Error) {
    return {
      error: err.message || "load_failed",
      name: err.name,
      stack: err.stack,
    };
  }
  return { error: typeof err === "string" ? err : "load_failed" };
}

function errorResponse(where: string, err: unknown) {
  const supa = supabaseErrorJson(err);
  const other = unknownErrorJson(err);
  return NextResponse.json(
    {
      where,
      // prefer Supabase-shaped details when present, but always include stack if we have it
      ...supa,
      stack: (other as any).stack,
      name: (other as any).name,
      raw: supa.error === "load_failed" ? other : undefined,
    },
    { status: 500 },
  );
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
  pickup_reliability_override_score?: number | null;
  pickup_reliability_override_reason?: string | null;
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
  lateCancelsLifetime: number,
) {
  const effective = (s?.effective_standing || "good") as PickupStandingLevel;
  const auto = (s?.auto_standing || "good") as PickupStandingLevel;
  const manual = (s?.manual_standing ?? null) as PickupStandingLevel | null;
  const joinOk = (effective === "good" || effective === "warning") && waiverOk;

  const confirmed = Number(p.confirmed_count || 0);
  const attended = Number(p.attended_count || 0);
  const strikes = Number(p.strike_count || 0);

  const lateCancels = Number(lateCancelsLifetime || 0);

  const reliability = computePickupReliability({
    confirmed,
    attended,
    lateCancels,
    noShows: strikes,
  });

  const overrideScoreRaw =
    p.pickup_reliability_override_score === null || p.pickup_reliability_override_score === undefined
      ? null
      : Number(p.pickup_reliability_override_score);
  const overrideScore = overrideScoreRaw === null || Number.isNaN(overrideScoreRaw) ? null : Math.max(0, Math.min(100, overrideScoreRaw));
  const effectiveScore = overrideScore === null ? reliability.scorePct : overrideScore;
  const effectiveBucket =
    effectiveScore == null
      ? reliability.bucket
      : effectiveScore >= 85
        ? "good"
        : effectiveScore >= 70
          ? "watch"
          : "needs_review";

  return {
    user_id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    instagram: p.instagram,
    tier: p.tier,
    confirmed_count: p.confirmed_count,
    attended_count: p.attended_count,
    strike_count: p.strike_count,
    reliability_tracked_pickups: reliability.trackedPickups,
    reliability_score_pct: effectiveScore,
    reliability_bucket: effectiveBucket,
    reliability_override_score_pct: overrideScore,
    reliability_override_reason: p.pickup_reliability_override_reason ?? null,
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
  try {
    const gate = await requireAdminBearer(req);
    if (!gate.ok) return gate.response;

    const url = new URL(req.url);
    const filter = parseFilter(url.searchParams.get("filter"));
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit") || 60)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

    const svc = supabaseService();

    const profSelect =
      "id,first_name,last_name,instagram,email,tier,approved,confirmed_count,attended_count,strike_count,pickup_reliability_override_score,pickup_reliability_override_reason";

    /** Load waiver set for many users */
    async function waiverSetFor(userIds: string[]) {
      if (!userIds.length) return new Set<string>();
      try {
        const { data, error } = await svc
          .from("user_waiver_acceptance")
          .select("user_id")
          .eq("version", CURRENT_WAIVER_VERSION)
          .in("user_id", userIds);
        if (error) throw error;
        return new Set((data || []).map((r) => r.user_id));
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] waiverSetFor failed", err);
        throw { where: "GET/waiverSetFor:user_waiver_acceptance", err };
      }
    }

    async function standingMapFor(userIds: string[]) {
      if (!userIds.length) return new Map<string, Record<string, unknown>>();
      try {
        const { data, error } = await svc
          .from("pickup_player_standing")
          .select("*")
          .in("user_id", userIds);
        if (error) throw error;
        return new Map(
          (data || []).map((r) => [r.user_id as string, r as Record<string, unknown>]),
        );
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] standingMapFor failed", err);
        throw { where: "GET/standingMapFor:pickup_player_standing", err };
      }
    }

    async function lateCancelMapFor(userIds: string[]) {
      if (!userIds.length) return new Map<string, number>();
      try {
        const { data, error } = await svc
          .from("pickup_reliability_incidents")
          .select("user_id")
          .eq("kind", "late_cancel")
          .in("user_id", userIds);

        if (error) throw error;

        const map = new Map<string, number>();
        for (const r of data || []) {
          const uid = String((r as any).user_id);
          map.set(uid, (map.get(uid) || 0) + 1);
        }
        return map;
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] lateCancelMapFor failed", err);
        throw { where: "GET/lateCancelMapFor:pickup_reliability_incidents", err };
      }
    }

    let profs: ProfileRow[] = [];

    if (filter === "warning" || filter === "suspended" || filter === "banned") {
      try {
        const { data: stRows, error: stErr } = await svc
          .from("pickup_player_standing")
          .select("*")
          .eq("effective_standing", filter)
          .order("updated_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (stErr) throw stErr;

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

        const { data: pRows, error: pErr } = await svc
          .from("profiles")
          .select(profSelect)
          .in("id", ids);
        if (pErr) throw pErr;

        const pBy = new Map((pRows || []).map((p) => [(p as ProfileRow).id, p as ProfileRow]));
        const waived = await waiverSetFor(ids);
        const lateMap = await lateCancelMapFor(ids);
        const rows = (stRows || [])
          .map((st) => {
            const p = pBy.get(st.user_id as string);
            if (!p) return null;
            if (!matchesQuery(p, q)) return null;
            return buildRow(
              p,
              st as Record<string, unknown>,
              waived.has(p.id),
              lateMap.get(p.id) ?? 0,
            );
          })
          .filter(Boolean);

        return NextResponse.json({
          filter,
          limit,
          offset,
          rows,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
        });
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] standing filter branch failed", err);
        return errorResponse(
          filter === "warning" || filter === "suspended" || filter === "banned"
            ? `GET/filter:${filter}`
            : "GET/filter:standing",
          (err as any)?.err ?? err,
        );
      }
    }

    if (filter === "missing_waiver") {
      try {
        const { data: waivedRows, error: waivedErr } = await svc
          .from("user_waiver_acceptance")
          .select("user_id")
          .eq("version", CURRENT_WAIVER_VERSION);
        if (waivedErr) throw waivedErr;

        const waived = new Set((waivedRows || []).map((r) => r.user_id));

        const { data: allApproved, error: apErr } = await svc
          .from("profiles")
          .select(profSelect)
          .eq("approved", true)
          .order("last_name", { ascending: true, nullsFirst: false })
          .limit(1500);

        if (apErr) throw apErr;

        const missing = (allApproved || [])
          .map((p) => p as ProfileRow)
          .filter((p) => !waived.has(p.id))
          .filter((p) => matchesQuery(p, q));

        const slice = missing.slice(offset, offset + limit);
        const ids = slice.map((p) => p.id);
        const stMap = await standingMapFor(ids);
        const lateMap = await lateCancelMapFor(ids);
        const rows = slice.map((p) =>
          buildRow(p, stMap.get(p.id) || null, false, lateMap.get(p.id) ?? 0),
        );

        return NextResponse.json({
          filter,
          limit,
          offset,
          rows,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
          total_estimate: missing.length,
        });
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] missing_waiver branch failed", err);
        const where = (err as any)?.where ?? "GET/filter:missing_waiver";
        return errorResponse(where, (err as any)?.err ?? err);
      }
    }

    if (filter === "good") {
      try {
        const { data: approved, error: apErr } = await svc
          .from("profiles")
          .select(profSelect)
          .eq("approved", true)
          .order("last_name", { ascending: true, nullsFirst: false })
          .limit(1500);

        if (apErr) throw apErr;

        const list = (approved || []) as ProfileRow[];
        const ids = list.map((p) => p.id);
        const [waivedSet, stMap, lateMap] = await Promise.all([
          waiverSetFor(ids),
          standingMapFor(ids),
          lateCancelMapFor(ids),
        ]);

        const goodList = list
          .filter((p) => waivedSet.has(p.id))
          .filter((p) => {
            const s = stMap.get(p.id);
            const eff = (s?.effective_standing as string) || "good";
            return eff === "good";
          })
          .filter((p) => matchesQuery(p, q));

        const slice = goodList.slice(offset, offset + limit);
        const rows = slice.map((p) =>
          buildRow(p, stMap.get(p.id) || null, true, lateMap.get(p.id) ?? 0),
        );

        return NextResponse.json({
          filter,
          limit,
          offset,
          rows,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
          total_estimate: goodList.length,
        });
      } catch (err: unknown) {
        console.error("[admin/pickup/standing][GET] good branch failed", err);
        const where = (err as any)?.where ?? "GET/filter:good";
        return errorResponse(where, (err as any)?.err ?? err);
      }
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

    try {
      const { data: profData, error: pErr } = await profQuery;
      if (pErr) throw pErr;

      profs = (profData || []) as ProfileRow[];
    } catch (err: unknown) {
      console.error("[admin/pickup/standing][GET] profiles(all) failed", err);
      return errorResponse("GET/filter:all profiles", err);
    }

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

    let waivedSet: Set<string>;
    let stMap: Map<string, Record<string, unknown>>;
    let lateMap: Map<string, number>;
    try {
      [waivedSet, stMap, lateMap] = await Promise.all([
        waiverSetFor(ids),
        standingMapFor(ids),
        lateCancelMapFor(ids),
      ]);
    } catch (err: unknown) {
      console.error("[admin/pickup/standing][GET] parallel maps failed", err);
      const where = (err as any)?.where ?? (err as any)?.err?.where ?? "GET/filter:all maps";
      return errorResponse(where, (err as any)?.err ?? err);
    }

    const rows = profs.map((p) =>
      buildRow(p, stMap.get(p.id) || null, waivedSet.has(p.id), lateMap.get(p.id) ?? 0),
    );

    return NextResponse.json({
      filter,
      limit,
      offset,
      rows,
      currentWaiverVersion: CURRENT_WAIVER_VERSION,
    });
  } catch (err: unknown) {
    const where = (err as any)?.where ?? "GET/top-level";
    const inner = (err as any)?.err ?? err;
    console.error("[admin/pickup/standing][GET] top-level failed", inner);
    if (inner instanceof Error) {
      console.error("[admin/pickup/standing][GET] top-level stack", inner.stack);
    }
    return errorResponse(where, inner);
  }
}

type PatchBody = {
  user_id?: string;
  manual_standing?: PickupStandingLevel | null | "";
  manual_reason?: string | null;
  staff_notes?: string | null;
  reliability_override_score_pct?: number | null | "";
  reliability_override_reason?: string | null;
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

  const overrideRaw = body?.reliability_override_score_pct;
  const overrideScore =
    overrideRaw === undefined
      ? undefined
      : overrideRaw === null || overrideRaw === ""
        ? null
        : Math.round(Number(overrideRaw));

  if (overrideScore !== undefined && overrideScore !== null && (Number.isNaN(overrideScore) || overrideScore < 0 || overrideScore > 100)) {
    return NextResponse.json({ error: "invalid reliability_override_score_pct" }, { status: 400 });
  }

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

  if (overrideScore !== undefined) {
    const upd = await svc
      .from("profiles")
      .update({
        pickup_reliability_override_score: overrideScore,
        pickup_reliability_override_reason: body?.reliability_override_reason ?? null,
        pickup_reliability_override_updated_by: gate.userId,
        pickup_reliability_override_updated_at: now,
        updated_at: now,
      })
      .eq("id", userId);
    if (upd.error) {
      console.error("[admin/pickup/standing] reliability override", upd.error.message);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
  }

  const { data: row } = await svc.from("pickup_player_standing").select("*").eq("user_id", userId).maybeSingle();
  return NextResponse.json({ ok: true, standing: row });
}
