function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function nyOffsetFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const tz = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return "-05:00";
  const sign = m[1] === "-" ? "-" : "+";
  const hh = pad2(Number(m[2]));
  const mm = pad2(Number(m[3] || "0"));
  return `${sign}${hh}:${mm}`;
}

function nyYMD(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return { y: y || "2000", m: m || "01", d: d || "01" };
}

/** 10:00 PM America/New_York the night before start_at */
export function computeCancellationDeadline(startAtISO: string) {
  const start = new Date(startAtISO);
  const { y, m, d } = nyYMD(start);
  const off = nyOffsetFor(start);
  const startDayAt2200 = new Date(`${y}-${m}-${d}T22:00:00${off}`);
  const cutoff = new Date(startDayAt2200.getTime() - 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

/** Earliest kickoff time for checkpoint math: run.start_at if set, else earliest slot. */
export function anchorStartAtMs(
  run: { start_at: string | null },
  slots: { start_at: string }[]
): number | null {
  let best: number | null = run.start_at ? new Date(run.start_at).getTime() : null;
  if (best !== null && !Number.isFinite(best)) best = null;
  for (const s of slots) {
    const t = new Date(s.start_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}
