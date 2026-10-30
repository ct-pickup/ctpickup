/** Notification settings: category switches and quiet hours. The server (lib/push/pushPolicy.ts) enforces them on every push. */

export type PushCategoryKey = "games" | "reminders" | "results" | "chat" | "fields" | "marketing";

export type PushSettings = {
  categories: Record<PushCategoryKey, boolean>;
  quiet: { enabled: boolean; start: number; end: number; timezone: string | null };
};

export const PUSH_CATEGORY_ROWS: { key: PushCategoryKey; title: string; sub: string }[] = [
  { key: "games", title: "Games", sub: "New games, invites, confirmations and cancellations" },
  { key: "reminders", title: "Reminders and waitlist", sub: "A spot opening up, time to confirm, rate your game" },
  { key: "results", title: "Results and awards", sub: "Scores, awards and voting" },
  { key: "chat", title: "Chat", sub: "Messages and announcements in your chats" },
  { key: "fields", title: "Field alerts", sub: "New games near you, open times, changes at saved fields" },
  { key: "marketing", title: "News and offers", sub: "Updates from us" },
];

export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  categories: { games: true, reminders: true, results: true, chat: true, fields: true, marketing: false },
  quiet: { enabled: false, start: 22 * 60, end: 7 * 60, timezone: null },
};

/** "10:30 PM" from minutes after midnight. */
export function formatMinutes(total: number): string {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Moves a time by `delta` minutes, wrapping around midnight. */
export function stepMinutes(value: number, delta: number): number {
  return (((value + delta) % 1440) + 1440) % 1440;
}

export function quietSummary(q: PushSettings["quiet"]): string {
  return q.enabled ? `${formatMinutes(q.start)} to ${formatMinutes(q.end)}` : "Off";
}

/** The device's time zone, e.g. "America/New_York". Null when the runtime cannot say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Anything the server returns that is not a clean settings object becomes the defaults. */
export function parseSettings(raw: unknown): PushSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PUSH_SETTINGS;
  const o = raw as { categories?: Record<string, unknown>; quiet?: Record<string, unknown> };
  const cat = (k: PushCategoryKey) => (typeof o.categories?.[k] === "boolean" ? (o.categories![k] as boolean) : DEFAULT_PUSH_SETTINGS.categories[k]);
  const min = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1439 ? v : d);
  return {
    categories: { games: cat("games"), reminders: cat("reminders"), results: cat("results"), chat: cat("chat"), fields: cat("fields"), marketing: cat("marketing") },
    quiet: {
      enabled: o.quiet?.enabled === true,
      start: min(o.quiet?.start, DEFAULT_PUSH_SETTINGS.quiet.start),
      end: min(o.quiet?.end, DEFAULT_PUSH_SETTINGS.quiet.end),
      timezone: typeof o.quiet?.timezone === "string" ? o.quiet.timezone : null,
    },
  };
}
