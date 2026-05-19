import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";

export const runtime = "nodejs";

function utcMonthBounds(year: number, month1to12: number): { start: string; end: string } {
  const m0 = month1to12 - 1;
  const startMs = Date.UTC(year, m0, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year, m0 + 1, 1, 0, 0, 0, 0);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

function prevMonth(year: number, month1to12: number): { year: number; month: number } {
  if (month1to12 <= 1) return { year: year - 1, month: 12 };
  return { year, month: month1to12 - 1 };
}

function parseMonthParam(raw: string | null): { year: number; month: number } {
  const now = new Date();
  const defY = now.getUTCFullYear();
  const defM = now.getUTCMonth() + 1;
  if (!raw || !/^\d{4}-\d{2}$/.test(raw.trim())) return { year: defY, month: defM };
  const [ys, ms] = raw.trim().split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || y < 2000 || y > 2100 || m < 1 || m > 12) return { year: defY, month: defM };
  return { year: y, month: m };
}

async function sumPaymentsCents(
  svc: ReturnType<typeof supabaseService>,
  startIso: string,
  endIso: string,
): Promise<number> {
  const pageSize = 1000;
  let offset = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await svc
      .from("platform_payments")
      .select("amount_cents")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const r of rows) {
      total += Number((r as { amount_cents?: number }).amount_cents || 0);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return total;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const ROW_PAGE = 800;


/** `null` = all regions; otherwise a hub region code. */
function parseScheduleRegionParam(raw: string | null): string | null {
  const u = String(raw || "").trim().toUpperCase();
  if (!u || u === "ALL") return null;
  return HUB_REGIONS.has(u) ? u : null;
}

const WEEKDAY_SHORT_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Day 0=Sun … 6=Sat and hour 0–23 in America/New_York. */
function etDayOfWeekAndHour(startAtIso: string): { day_of_week: number; hour: number } | null {
  const d = new Date(startAtIso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const wdRaw = parts.find((p) => p.type === "weekday")?.value ?? "";
  const wd = wdRaw.replace(/\./g, "").slice(0, 3);
  const day_of_week = WEEKDAY_SHORT_TO_DOW[wd];
  if (day_of_week === undefined) return null;
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "";
  const hour = Number.parseInt(hourStr, 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { day_of_week, hour };
}

export type BestTimeSlot = {
  day_of_week: number;
  hour: number;
  avg_confirmed: number;
  run_count: number;
};

async function loadCompletedRunsLast90Days(
  svc: ReturnType<typeof supabaseService>,
  startIso: string,
  endIso: string,
  serviceRegion: string | null,
): Promise<{ id: string; start_at: string }[]> {
  const all: { id: string; start_at: string }[] = [];
  let from = 0;
  for (;;) {
    let q = svc
      .from("pickup_runs")
      .select("id,start_at")
      .eq("is_completed", true)
      .gte("start_at", startIso)
      .lte("start_at", endIso)
      .order("id", { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (serviceRegion) q = q.eq("service_region", serviceRegion);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as { id: string; start_at: string }[];
    all.push(...rows);
    if (rows.length < ROW_PAGE) break;
    from += ROW_PAGE;
  }
  return all;
}

async function confirmedCountsByRun(
  svc: ReturnType<typeof supabaseService>,
  runIds: string[],
): Promise<Map<string, number>> {
  const confirmedByRun = new Map<string, number>();
  for (const part of chunk(runIds, 100)) {
    if (!part.length) continue;
    let off = 0;
    for (;;) {
      const rsvpRes = await svc
        .from("pickup_run_rsvps")
        .select("run_id")
        .in("run_id", part)
        .eq("status", "confirmed")
        .range(off, off + ROW_PAGE - 1);
      if (rsvpRes.error) throw new Error(rsvpRes.error.message);
      const rRows = rsvpRes.data || [];
      for (const row of rRows) {
        const rid = String((row as { run_id: string }).run_id);
        confirmedByRun.set(rid, (confirmedByRun.get(rid) || 0) + 1);
      }
      if (rRows.length < ROW_PAGE) break;
      off += ROW_PAGE;
    }
  }
  return confirmedByRun;
}

async function computeBestTimes(
  svc: ReturnType<typeof supabaseService>,
  serviceRegion: string | null,
  now: Date,
): Promise<BestTimeSlot[]> {
  const endIso = now.toISOString();
  const startMs = now.getTime() - 90 * 864e5;
  const startIso = new Date(startMs).toISOString();

  let runs: { id: string; start_at: string }[];
  try {
    runs = await loadCompletedRunsLast90Days(svc, startIso, endIso, serviceRegion);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/analytics] best_times runs:", msg);
    throw e;
  }

  if (!runs.length) return [];

  const runIds = runs.map((r) => String(r.id));
  let confirmedByRun: Map<string, number>;
  try {
    confirmedByRun = await confirmedCountsByRun(svc, runIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/analytics] best_times rsvps:", msg);
    throw e;
  }

  type Agg = { sum: number; run_count: number };
  const bySlot = new Map<string, Agg>();

  for (const r of runs) {
    const parts = etDayOfWeekAndHour(r.start_at);
    if (!parts) continue;
    const key = `${parts.day_of_week}:${parts.hour}`;
    const confirmed = confirmedByRun.get(String(r.id)) || 0;
    const cur = bySlot.get(key) || { sum: 0, run_count: 0 };
    cur.sum += confirmed;
    cur.run_count += 1;
    bySlot.set(key, cur);
  }

  const slots: BestTimeSlot[] = [];
  for (const [key, agg] of bySlot) {
    if (agg.run_count < 2) continue;
    const [ds, hs] = key.split(":");
    const day_of_week = Number(ds);
    const hour = Number(hs);
    slots.push({
      day_of_week,
      hour,
      avg_confirmed: Math.round((agg.sum / agg.run_count) * 10) / 10,
      run_count: agg.run_count,
    });
  }

  slots.sort((a, b) => b.avg_confirmed - a.avg_confirmed || b.run_count - a.run_count);
  return slots.slice(0, 5);
}

async function loadCompletedRunsInRange(
  svc: ReturnType<typeof supabaseService>,
  startIso: string,
  endIso: string,
): Promise<{ id: string; service_region: string | null; start_at: string }[]> {
  const all: { id: string; service_region: string | null; start_at: string }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await svc
      .from("pickup_runs")
      .select("id,service_region,start_at")
      .eq("is_completed", true)
      .gte("start_at", startIso)
      .lt("start_at", endIso)
      .order("id", { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { id: string; service_region: string | null; start_at: string }[];
    all.push(...rows);
    if (rows.length < ROW_PAGE) break;
    from += ROW_PAGE;
  }
  return all;
}

/** Half-open interval on `start_at`: [low, highExclusive). */
async function loadCompletedRunIdsHalfOpen(
  svc: ReturnType<typeof supabaseService>,
  low: string,
  highExclusive: string,
): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await svc
      .from("pickup_runs")
      .select("id")
      .eq("is_completed", true)
      .gte("start_at", low)
      .lt("start_at", highExclusive)
      .order("id", { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const r of rows) ids.push(String((r as { id: string }).id));
    if (rows.length < ROW_PAGE) break;
    from += ROW_PAGE;
  }
  return ids;
}

/** All profiles with a `nearest_venue` or ZIP: counts by venue (non-empty) and top zip codes (5-digit US). */
async function aggregatePlayerLocations(svc: ReturnType<typeof supabaseService>): Promise<{
  players_by_venue: { venue: string; count: number }[];
  players_by_zip: { zip_code: string; count: number }[];
}> {
  const venueMap = new Map<string, number>();
  const zipMap = new Map<string, number>();
  let from = 0;
  let profilePages = 0;
  let profilesScanned = 0;
  for (;;) {
    const { data, error } = await svc
      .from("profiles")
      .select("nearest_venue,zip_code")
      .order("id", { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { nearest_venue: string | null; zip_code: string | null }[];
    profilePages += 1;
    profilesScanned += rows.length;
    for (const row of rows) {
      const nv = row.nearest_venue != null ? String(row.nearest_venue).trim() : "";
      if (nv) venueMap.set(nv, (venueMap.get(nv) || 0) + 1);

      const zDigits = row.zip_code != null ? String(row.zip_code).replace(/\D/g, "") : "";
      const z = zDigits.slice(0, 5);
      if (z.length === 5) zipMap.set(z, (zipMap.get(z) || 0) + 1);
    }
    if (rows.length < ROW_PAGE) break;
    from += ROW_PAGE;
  }

  const players_by_venue = Array.from(venueMap.entries())
    .map(([venue, count]) => ({ venue, count }))
    .sort((a, b) => b.count - a.count || a.venue.localeCompare(b.venue));

  const players_by_zip = Array.from(zipMap.entries())
    .map(([zip_code, count]) => ({ zip_code, count }))
    .sort((a, b) => b.count - a.count || a.zip_code.localeCompare(b.zip_code))
    .slice(0, 10);

  console.log("[admin/analytics] players_by_venue / players_by_zip aggregation", {
    profilePages,
    profilesScanned,
    venueBuckets: players_by_venue.length,
    zipBuckets: players_by_zip.length,
    players_by_venue_preview: players_by_venue.slice(0, 5),
    players_by_zip_preview: players_by_zip.slice(0, 5),
  });

  return { players_by_venue, players_by_zip };
}

/** Inclusive upper bound on `start_at`: [low, highInclusive]. */
async function loadCompletedRunIdsClosedEnd(
  svc: ReturnType<typeof supabaseService>,
  low: string,
  highInclusive: string,
): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await svc
      .from("pickup_runs")
      .select("id")
      .eq("is_completed", true)
      .gte("start_at", low)
      .lte("start_at", highInclusive)
      .order("id", { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const r of rows) ids.push(String((r as { id: string }).id));
    if (rows.length < ROW_PAGE) break;
    from += ROW_PAGE;
  }
  return ids;
}

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const scheduleRegion = parseScheduleRegionParam(url.searchParams.get("schedule_region"));
  const { year, month } = parseMonthParam(url.searchParams.get("month"));
  const { start: monthStart, end: monthEnd } = utcMonthBounds(year, month);
  const pm = prevMonth(year, month);
  const { start: prevStart, end: prevEnd } = utcMonthBounds(pm.year, pm.month);

  const svc = supabaseService();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 864e5).toISOString();
  const sixtyDaysBeforeMonth = new Date(Date.parse(monthStart) - 60 * 864e5).toISOString();

  try {
    const [current_month_cents, prev_month_cents, locationAgg] = await Promise.all([
      sumPaymentsCents(svc, monthStart, monthEnd),
      sumPaymentsCents(svc, prevStart, prevEnd),
      aggregatePlayerLocations(svc),
    ]);

    let monthRuns: { id: string; service_region: string | null; start_at: string }[];
    try {
      monthRuns = await loadCompletedRunsInRange(svc, monthStart, monthEnd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[admin/analytics] runs:", msg);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const runIds = monthRuns.map((r) => String(r.id));

    const regionCounts = new Map<string, number>();
    for (const r of monthRuns) {
      const reg = (r.service_region ? String(r.service_region).trim().toUpperCase() : "") || "—";
      regionCounts.set(reg, (regionCounts.get(reg) || 0) + 1);
    }
    const runs_per_region = Array.from(regionCounts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));

    const confirmedByRun = new Map<string, number>();
    const attendedByRun = new Map<string, number>();
    const sessionCounts = new Map<string, number>();

    for (const part of chunk(runIds, 100)) {
      if (!part.length) continue;
      let off = 0;
      for (;;) {
        const rsvpRes = await svc
          .from("pickup_run_rsvps")
          .select("run_id,status")
          .in("run_id", part)
          .eq("status", "confirmed")
          .range(off, off + ROW_PAGE - 1);
        if (rsvpRes.error) {
          console.error("[admin/analytics] rsvps:", rsvpRes.error.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        const rRows = rsvpRes.data || [];
        for (const row of rRows) {
          const rid = String((row as { run_id: string }).run_id);
          confirmedByRun.set(rid, (confirmedByRun.get(rid) || 0) + 1);
        }
        if (rRows.length < ROW_PAGE) break;
        off += ROW_PAGE;
      }

      off = 0;
      for (;;) {
        const attRes = await svc
          .from("pickup_run_attendance")
          .select("run_id,user_id")
          .in("run_id", part)
          .eq("attended", true)
          .range(off, off + ROW_PAGE - 1);
        if (attRes.error) {
          console.error("[admin/analytics] attendance:", attRes.error.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        const aRows = attRes.data || [];
        for (const row of aRows) {
          const rid = String((row as { run_id: string }).run_id);
          const uid = String((row as { user_id: string }).user_id);
          attendedByRun.set(rid, (attendedByRun.get(rid) || 0) + 1);
          sessionCounts.set(uid, (sessionCounts.get(uid) || 0) + 1);
        }
        if (aRows.length < ROW_PAGE) break;
        off += ROW_PAGE;
      }
    }

    let ratioSum = 0;
    let ratioRuns = 0;
    for (const r of monthRuns) {
      const rid = String(r.id);
      const confirmed = confirmedByRun.get(rid) || 0;
      if (confirmed <= 0) continue;
      const attended = attendedByRun.get(rid) || 0;
      ratioSum += Math.min(1, attended / confirmed);
      ratioRuns += 1;
    }
    const avg_attendance_rate = ratioRuns > 0 ? ratioSum / ratioRuns : null;

    const topEntries = Array.from(sessionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const topUserIds = topEntries.map(([uid]) => uid);

    let most_active_players: {
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      instagram: string | null;
      sessions_this_month: number;
    }[] = [];

    if (topUserIds.length) {
      const { data: profs, error: pe } = await svc
        .from("profiles")
        .select("id,first_name,last_name,instagram")
        .in("id", topUserIds);
      if (pe) {
        console.error("[admin/analytics] profiles top:", pe.message);
        return NextResponse.json({ error: "load_failed" }, { status: 500 });
      }
      const byId = new Map((profs || []).map((p) => [String((p as { id: string }).id), p as Record<string, unknown>]));
      most_active_players = topEntries.map(([user_id, sessions_this_month]) => {
        const p = byId.get(user_id);
        return {
          user_id,
          first_name: p ? (p.first_name as string | null) ?? null : null,
          last_name: p ? (p.last_name as string | null) ?? null : null,
          instagram: p ? (p.instagram as string | null) ?? null : null,
          sessions_this_month,
        };
      });
    }

    const nowIso = now.toISOString();
    let w1RunIds: string[];
    let w2RunIds: string[];
    try {
      w1RunIds = await loadCompletedRunIdsHalfOpen(svc, sixtyDaysBeforeMonth, monthStart);
      w2RunIds = await loadCompletedRunIdsClosedEnd(svc, thirtyDaysAgo, nowIso);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[admin/analytics] w1/w2 runs:", msg);
      return NextResponse.json({ error: "load_failed" }, { status: 500 });
    }

    const usersW1 = new Set<string>();
    for (const part of chunk(w1RunIds, 80)) {
      if (!part.length) continue;
      let off = 0;
      for (;;) {
        const { data, error } = await svc
          .from("pickup_run_attendance")
          .select("user_id")
          .in("run_id", part)
          .eq("attended", true)
          .range(off, off + ROW_PAGE - 1);
        if (error) {
          console.error("[admin/analytics] w1 att:", error.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        const rows = data || [];
        for (const row of rows) usersW1.add(String((row as { user_id: string }).user_id));
        if (rows.length < ROW_PAGE) break;
        off += ROW_PAGE;
      }
    }

    const usersW2 = new Set<string>();
    for (const part of chunk(w2RunIds, 80)) {
      if (!part.length) continue;
      let off = 0;
      for (;;) {
        const { data, error } = await svc
          .from("pickup_run_attendance")
          .select("user_id")
          .in("run_id", part)
          .eq("attended", true)
          .range(off, off + ROW_PAGE - 1);
        if (error) {
          console.error("[admin/analytics] w2 att:", error.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        const rows = data || [];
        for (const row of rows) usersW2.add(String((row as { user_id: string }).user_id));
        if (rows.length < ROW_PAGE) break;
        off += ROW_PAGE;
      }
    }

    const churnUserIds: string[] = [];
    for (const uid of usersW1) {
      if (!usersW2.has(uid)) churnUserIds.push(uid);
    }

    const lastAttended = new Map<string, string>();
    if (churnUserIds.length) {
      const pairs: { user_id: string; run_id: string }[] = [];
      for (const uPart of chunk(churnUserIds, 40)) {
        let off = 0;
        for (;;) {
          const { data, error: attErr } = await svc
            .from("pickup_run_attendance")
            .select("user_id,run_id")
            .in("user_id", uPart)
            .eq("attended", true)
            .range(off, off + ROW_PAGE - 1);
          if (attErr) {
            console.error("[admin/analytics] churn att:", attErr.message);
            return NextResponse.json({ error: "load_failed" }, { status: 500 });
          }
          const rows = data || [];
          for (const row of rows) {
            pairs.push({
              user_id: String((row as { user_id: string }).user_id),
              run_id: String((row as { run_id: string }).run_id),
            });
          }
          if (rows.length < ROW_PAGE) break;
          off += ROW_PAGE;
        }
      }
      const runIdsForLast = Array.from(new Set(pairs.map((p) => p.run_id)));
      const startByRun = new Map<string, string>();
      for (const part of chunk(runIdsForLast, 120)) {
        if (!part.length) continue;
        const { data: runs, error: re } = await svc
          .from("pickup_runs")
          .select("id,start_at")
          .in("id", part)
          .eq("is_completed", true);
        if (re) {
          console.error("[admin/analytics] churn runs:", re.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        for (const row of runs || []) {
          const id = String((row as { id: string }).id);
          const sa = (row as { start_at: string }).start_at;
          if (sa) startByRun.set(id, String(sa));
        }
      }
      for (const row of pairs) {
        const uid = row.user_id;
        const rid = row.run_id;
        const sa = startByRun.get(rid);
        if (!sa) continue;
        const prev = lastAttended.get(uid);
        if (!prev || Date.parse(sa) > Date.parse(prev)) lastAttended.set(uid, sa);
      }
    }

    let churn_at_risk: {
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      instagram: string | null;
      last_attended_at: string | null;
    }[] = [];

    if (churnUserIds.length) {
      const profById = new Map<string, Record<string, unknown>>();
      for (const idPart of chunk(churnUserIds, 100)) {
        const { data: cprofs, error: ce } = await svc
          .from("profiles")
          .select("id,first_name,last_name,instagram")
          .in("id", idPart);
        if (ce) {
          console.error("[admin/analytics] churn profiles:", ce.message);
          return NextResponse.json({ error: "load_failed" }, { status: 500 });
        }
        for (const p of cprofs || []) {
          const rec = p as Record<string, unknown>;
          profById.set(String(rec.id), rec);
        }
      }
      churn_at_risk = churnUserIds.map((id) => {
        const rec = profById.get(id);
        return {
          user_id: id,
          first_name: rec ? ((rec.first_name as string | null) ?? null) : null,
          last_name: rec ? ((rec.last_name as string | null) ?? null) : null,
          instagram: rec ? ((rec.instagram as string | null) ?? null) : null,
          last_attended_at: lastAttended.get(id) ?? null,
        };
      });
      churn_at_risk.sort((a, b) => {
        const ta = a.last_attended_at ? Date.parse(a.last_attended_at) : 0;
        const tb = b.last_attended_at ? Date.parse(b.last_attended_at) : 0;
        return ta - tb;
      });
    }

    const best_times = await computeBestTimes(svc, scheduleRegion, now);

    return NextResponse.json({
      ok: true,
      month: `${year}-${String(month).padStart(2, "0")}`,
      revenue: { current_month_cents, prev_month_cents },
      players_by_venue: locationAgg.players_by_venue,
      players_by_zip: locationAgg.players_by_zip,
      runs_per_region,
      attendance: { avg_attendance_rate },
      most_active_players,
      churn_at_risk,
      best_times,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/analytics]", msg);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
