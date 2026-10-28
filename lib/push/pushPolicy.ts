import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a player allows us to push, and when. Enforced in lib/push/sendExpoPush.ts for every send path.
 *
 *   categories   games, reminders (waitlist and reminders), results (results and awards), chat, fields, marketing
 *   quiet hours  no pushes between start and end in the player's time zone
 *   urgent       a push marked urgent skips quiet hours, but never a category the player switched off
 *
 * A push whose kind we do not know is "other": account, payment and admin pushes. Those are always sent.
 * Missing preference columns (the migration is not applied yet) mean defaults: everything on, no quiet hours.
 */

export type PushCategory = "games" | "reminders" | "results" | "chat" | "fields" | "marketing" | "other";
export const CONTROLLABLE_CATEGORIES = ["games", "reminders", "results", "chat", "fields", "marketing"] as const;

const KIND_CATEGORY: Record<string, PushCategory> = {
  // games
  pickup_invite: "games",
  pickup_new_run: "games",
  pickup_likely_on: "games",
  pickup_finalized: "games",
  pickup_rsvp_confirmed: "games",
  pickup_admin_confirmed: "games",
  pickup_canceled: "games",
  pickup_over_capacity_refund: "games",
  session_new: "games",
  session_canceled: "games",
  session_left: "games",
  session_left_payer_refund: "games",
  session_left_payer_credit: "games",
  run_invite: "games",
  player_follow: "games",
  player_followed_joined: "games",
  host_new_run: "games",
  play_again: "games",
  play_again_ask: "games",
  roster_invite: "games",
  tournament_live: "games",
  tournament_canceled: "games",
  tournament_bracket_generated: "games",
  tournament_roster_invite: "games",
  tournament_roster_response: "games",
  tournament_join_request: "games",
  tournament_join_decision: "games",
  tournament_captain_payment_confirmed: "games",
  esports_tournament_live: "games",
  // reminders and waitlist
  pickup_waitlist_offer: "reminders",
  pickup_waitlist_expiring: "reminders",
  pickup_promoted: "reminders",
  session_rate_reminder: "reminders",
  tournament_starts_soon: "reminders",
  // results and awards
  pickup_result: "results",
  session_result: "results",
  session_voting_open: "results",
  season_standings: "results",
  tournament_mvp_vote: "results",
  // chat
  chat_message: "chat",
  announcement: "chat",
  // Fields
  fields_new_game: "fields",
  fields_slot_open: "fields",
  fields_change: "fields",
};

export function pushCategoryFor(data: unknown): PushCategory {
  if (!data || typeof data !== "object") return "other";
  const d = data as { kind?: unknown; screen?: unknown };
  const kind = typeof d.kind === "string" ? d.kind : "";
  if (kind in KIND_CATEGORY) return KIND_CATEGORY[kind]!;
  if (kind.startsWith("pickup_award_")) return "results";
  if (d.screen === "field-requests") return "fields";
  return "other";
}

export type QuietHours = { enabled: boolean; start: number; end: number; tz: string | null };
export type PushPrefs = { categories: Record<Exclude<PushCategory, "other" | "marketing">, boolean>; marketing: boolean; quiet: QuietHours };

export const DEFAULT_QUIET_START = 22 * 60;
export const DEFAULT_QUIET_END = 7 * 60;
export const DEFAULT_PUSH_PREFS: PushPrefs = {
  categories: { games: true, reminders: true, results: true, chat: true, fields: true },
  marketing: false, // opt-in
  quiet: { enabled: false, start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END, tz: null },
};

const FALLBACK_TZ = "America/New_York";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Minutes after midnight in the zone (an unknown zone falls back to US Eastern). */
export function minutesInZone(now: Date, tz: string | null): number {
  const zone = tz && isValidTimeZone(tz) ? tz : FALLBACK_TZ;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Start inclusive, end exclusive. Start after end crosses midnight. Start equal to end means no quiet window. */
export function inQuietHours(now: Date, q: QuietHours): boolean {
  if (!q.enabled || q.start === q.end) return false;
  const t = minutesInZone(now, q.tz);
  return q.start < q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

export type PushDecision = { send: true } | { send: false; reason: "category_off" | "quiet_hours" };

export function decidePush(prefs: PushPrefs, category: PushCategory, urgent: boolean, now: Date): PushDecision {
  if (category === "marketing" && !prefs.marketing) return { send: false, reason: "category_off" };
  if (category !== "other" && category !== "marketing" && prefs.categories[category] === false) return { send: false, reason: "category_off" };
  if (!urgent && inQuietHours(now, prefs.quiet)) return { send: false, reason: "quiet_hours" };
  return { send: true };
}

const ET = "America/New_York";
const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ET });

/** A waitlist spot opening for a game that starts within 2 hours (or began in the last hour) may break quiet hours. */
export function isUrgentWaitlistOffer(gameStartIso: string | null | undefined, now: Date): boolean {
  if (!gameStartIso) return false;
  const start = Date.parse(gameStartIso);
  if (!Number.isFinite(start)) return false;
  const ahead = start - now.getTime();
  return ahead <= 2 * 3_600_000 && ahead > -3_600_000;
}

/** A cancellation for a game played today (US Eastern calendar day) may break quiet hours. */
export function isCancellationToday(gameStartIso: string | null | undefined, now: Date): boolean {
  if (!gameStartIso) return false;
  const start = new Date(gameStartIso);
  if (!Number.isFinite(start.getTime())) return false;
  return etDay(start) === etDay(now);
}

type ProfilePrefRow = {
  id: string;
  push_cat_games?: boolean | null;
  push_cat_reminders?: boolean | null;
  push_cat_results?: boolean | null;
  push_cat_chat?: boolean | null;
  push_cat_fields?: boolean | null;
  marketing_push_enabled?: boolean | null;
  quiet_hours_enabled?: boolean | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  quiet_hours_tz?: string | null;
};

export const PUSH_PREF_COLUMNS =
  "id,push_cat_games,push_cat_reminders,push_cat_results,push_cat_chat,push_cat_fields,marketing_push_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,quiet_hours_tz";

export function prefsFromRow(r: ProfilePrefRow | null | undefined): PushPrefs {
  if (!r) return DEFAULT_PUSH_PREFS;
  const bool = (v: boolean | null | undefined) => v !== false;
  const minute = (v: number | null | undefined, d: number) => (typeof v === "number" && v >= 0 && v <= 1439 ? v : d);
  return {
    categories: { games: bool(r.push_cat_games), reminders: bool(r.push_cat_reminders), results: bool(r.push_cat_results), chat: bool(r.push_cat_chat), fields: bool(r.push_cat_fields) },
    // marketing is opt-in, so a missing value means off, unlike the categories above
    marketing: r.marketing_push_enabled === true,
    quiet: { enabled: r.quiet_hours_enabled === true, start: minute(r.quiet_hours_start, DEFAULT_QUIET_START), end: minute(r.quiet_hours_end, DEFAULT_QUIET_END), tz: r.quiet_hours_tz ?? null },
  };
}

/** Preferences for each player. If the columns cannot be read (migration not applied) players get the defaults, so pushes keep working. */
export async function loadPushPrefs(admin: SupabaseClient, userIds: string[]): Promise<Map<string, PushPrefs>> {
  const out = new Map<string, PushPrefs>();
  const CHUNK = 200;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const { data, error } = await admin.from("profiles").select(PUSH_PREF_COLUMNS).in("id", userIds.slice(i, i + CHUNK));
    if (error) {
      // The new columns are missing: fall back to what existed before (marketing opt-in only).
      const old = await admin.from("profiles").select("id,marketing_push_enabled").in("id", userIds.slice(i, i + CHUNK));
      for (const r of (old.data ?? []) as ProfilePrefRow[]) out.set(r.id, { ...DEFAULT_PUSH_PREFS, marketing: r.marketing_push_enabled === true });
      continue;
    }
    for (const r of (data ?? []) as ProfilePrefRow[]) out.set(r.id, prefsFromRow(r));
  }
  return out;
}

export type PolicyResult = { allowed: string[]; suppressed: { userId: string; reason: "category_off" | "quiet_hours" }[] };

/** Splits the recipients into who may be pushed now and who may not (and why). A player with no profile row gets the defaults. */
export async function applyPushPolicy(admin: SupabaseClient, userIds: string[], category: PushCategory, opts: { urgent?: boolean; now?: Date } = {}): Promise<PolicyResult> {
  const now = opts.now ?? new Date();
  const prefs = await loadPushPrefs(admin, userIds);
  const allowed: string[] = [];
  const suppressed: PolicyResult["suppressed"] = [];
  for (const id of userIds) {
    const d = decidePush(prefs.get(id) ?? DEFAULT_PUSH_PREFS, category, opts.urgent === true, now);
    if (d.send) allowed.push(id);
    else suppressed.push({ userId: id, reason: d.reason });
  }
  return { allowed, suppressed };
}
