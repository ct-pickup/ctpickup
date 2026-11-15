/**
 * When the tournament entry points show, and what they say. Pure: no React and no `@/` imports, so the root tests can run it.
 *
 * Two places show a tournament:
 *   Events tab   a "Tournaments" section at the top. Lists every tournament that is not over, as far ahead as it is scheduled.
 *   Home         one card under the date strip. Only while a tournament is under way or starts within 7 days.
 * Both hide completely when there is nothing to show, and both show a Live tag while a match is being played.
 *
 * "Not over" means: not finished (24 hours after the final gets its result it drops off) and not stale (a tournament that started
 * more than 14 days ago with no match being played is a forgotten row, not an event).
 */

export type TournamentListItem = {
  id: string;
  title: string;
  start_at: string | null;
  venue: string | null;
  service_region: string | null;
  live: boolean;
  has_bracket: boolean;
  final_completed_at: string | null;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The Home card appears this long before a tournament starts. */
export const HOME_WINDOW_MS = 7 * DAY;
/** How long a finished tournament stays listed after its final gets a result. */
export const FINISHED_GRACE_MS = 24 * HOUR;
/** A tournament that started this long ago, with no match being played, is treated as forgotten. */
export const STALE_AFTER_MS = 14 * DAY;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : null;
};

/** Reads the list route's response. Anything that is not a tournament with an id is dropped. */
export function parseTournamentList(json: unknown): TournamentListItem[] {
  const o = obj(json);
  if (!o || !Array.isArray(o.tournaments)) return [];
  const out: TournamentListItem[] = [];
  for (const x of o.tournaments) {
    const r = obj(x);
    const id = str(r?.id);
    if (!r || !id) continue;
    out.push({
      id,
      title: str(r.title) ?? "Tournament",
      start_at: str(r.start_at),
      venue: str(r.venue),
      service_region: str(r.service_region),
      live: r.live === true,
      has_bracket: r.has_bracket === true,
      final_completed_at: str(r.final_completed_at),
    });
  }
  return out;
}

/** The final has a result and the grace period has passed. */
export function isFinished(t: Pick<TournamentListItem, "final_completed_at">, now: number): boolean {
  const done = ms(t.final_completed_at);
  return done != null && now - done >= FINISHED_GRACE_MS;
}

/** Started long ago, nothing being played. */
export function isStale(t: Pick<TournamentListItem, "start_at" | "live">, now: number): boolean {
  const start = ms(t.start_at);
  return !t.live && start != null && now - start > STALE_AFTER_MS;
}

function byRelevance(a: TournamentListItem, b: TournamentListItem): number {
  if (a.live !== b.live) return a.live ? -1 : 1;
  const sa = ms(a.start_at);
  const sb = ms(b.start_at);
  if (sa == null && sb == null) return a.title.localeCompare(b.title);
  if (sa == null) return 1;
  if (sb == null) return -1;
  return sa - sb || a.title.localeCompare(b.title);
}

/** The Events tab list: everything not over, live first, then soonest. Empty means the section is hidden. */
export function listedTournaments(items: readonly TournamentListItem[], now: number): TournamentListItem[] {
  return items.filter((t) => !isFinished(t, now) && !isStale(t, now)).sort(byRelevance);
}

/**
 * The Home card: the most relevant listed tournament that is under way or starts within 7 days, or null (card hidden).
 * A tournament with no start date is never on Home: there is nothing to say about when.
 */
export function homeTournament(items: readonly TournamentListItem[], now: number): TournamentListItem | null {
  for (const t of listedTournaments(items, now)) {
    if (t.live) return t;
    const start = ms(t.start_at);
    if (start == null) continue;
    if (start <= now) return t;
    if (start - now <= HOME_WINDOW_MS) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------------

const ET = "America/New_York";

function etDay(t: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY;
}

function etTime(t: number): string {
  return `${new Date(t).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" })} ET`;
}

/** "Starts tomorrow, 2:00 PM ET", "Starts Saturday, 2:00 PM ET", "Under way", or "Date to be announced". */
export function whenText(t: Pick<TournamentListItem, "start_at" | "live" | "has_bracket">, now: number): string {
  if (t.live) return "Matches under way";
  const start = ms(t.start_at);
  if (start == null) return "Date to be announced";
  if (start <= now) return t.has_bracket ? "Under way" : "Started";
  const days = etDay(start) - etDay(now);
  const day =
    days <= 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : days < 7
          ? new Date(start).toLocaleDateString("en-US", { timeZone: ET, weekday: "long" })
          : new Date(start).toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" });
  return `Starts ${day}, ${etTime(start)}`;
}

/** The line under the title: when, then where. */
export function subtitleText(t: Pick<TournamentListItem, "start_at" | "live" | "has_bracket" | "venue">, now: number): string {
  return [whenText(t, now), t.venue].filter((p): p is string => Boolean(p)).join(" · ");
}
