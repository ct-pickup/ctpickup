import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

const TZ = "America/New_York";

export type MonthlyMetricRow = { user_id: string; count: number };

/** Higher monthly count wins; ties broken by higher lifetime confirmed attendance. */
export function compareByCountThenLifetimeAttendance(
  a: MonthlyMetricRow,
  b: MonthlyMetricRow,
  lifetimeAttendance: Map<string, number>,
): number {
  if (b.count !== a.count) return b.count - a.count;
  const aLife = lifetimeAttendance.get(a.user_id) ?? 0;
  const bLife = lifetimeAttendance.get(b.user_id) ?? 0;
  return bLife - aLife;
}

/**
 * Lifetime confirmed pickup attendance for tiebreakers.
 * Prefers profiles.pickup_sessions_count; falls back to counting confirmed RSVPs.
 */
export async function fetchLifetimeConfirmedAttendance(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;

  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id,pickup_sessions_count")
    .in("id", ids);

  const needsRsvpCount: string[] = [];

  if (!profErr && profiles) {
    const seen = new Set<string>();
    for (const row of profiles) {
      const id = String((row as { id: string }).id || "").trim();
      if (!id) continue;
      seen.add(id);
      const n = (row as { pickup_sessions_count: number | null }).pickup_sessions_count;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
        map.set(id, n);
      } else {
        needsRsvpCount.push(id);
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) needsRsvpCount.push(id);
    }
  } else {
    needsRsvpCount.push(...ids);
  }

  if (!needsRsvpCount.length) return map;

  const { data: rsvps, error: rsvpErr } = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("status", "confirmed")
    .in("user_id", needsRsvpCount);

  for (const id of needsRsvpCount) map.set(id, 0);
  if (!rsvpErr) {
    for (const row of rsvps || []) {
      const uid = String((row as { user_id: string }).user_id || "").trim();
      if (!uid) continue;
      map.set(uid, (map.get(uid) ?? 0) + 1);
    }
  }

  return map;
}

export type EtMonthRange = {
  startIso: string;
  endIso: string;
  /** yyyy-MM in Eastern */
  monthKey: string;
};

export function etNow(): DateTime {
  return DateTime.now().setZone(TZ);
}

/** Inclusive calendar month bounds in UTC ISO for queries. */
export function calendarMonthRangeEt(dt: DateTime): EtMonthRange {
  const start = dt.startOf("month");
  const end = dt.endOf("month");
  return {
    startIso: start.toUTC().toISO() ?? start.toUTC().toString(),
    endIso: end.toUTC().toISO() ?? end.toUTC().toString(),
    monthKey: dt.toFormat("yyyy-MM"),
  };
}

export function previousCalendarMonthRangeEt(now = etNow()): EtMonthRange {
  return calendarMonthRangeEt(now.minus({ months: 1 }));
}

export function currentCalendarMonthRangeEt(now = etNow()): EtMonthRange {
  return calendarMonthRangeEt(now);
}

/** Start of current calendar month in ET (for idempotent monthly award checks). */
export function currentCalendarMonthStartIsoEt(now = etNow()): string {
  const start = now.startOf("month");
  return start.toUTC().toISO() ?? start.toUTC().toString();
}

export function expiresThreeMonthsFromNowIso(now = DateTime.utc()): string {
  const exp = now.plus({ months: 3 });
  return exp.toISO() ?? exp.toString();
}
