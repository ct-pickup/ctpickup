/**
 * The in-app alert feed behind the bell. Pure: grouping and routing only, so the
 * route and the app agree on what a notification means.
 */

export type NotificationKind =
  | "game_invite"
  | "join_confirmed"
  | "payment_confirmed"
  | "result_posted"
  | "rating_updated"
  | "announcement"
  | "verification_update";

export type NotificationItem = {
  id: string;
  kind: NotificationKind | string;
  title: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Route hints, e.g. { run_id }. */
  data: Record<string, unknown>;
  unread: boolean;
};

export type NotificationsResponse = {
  items: NotificationItem[];
  unread: number;
};

/** Icon per kind, so the list reads at a glance. FontAwesome names. */
export const NOTIFICATION_ICONS: Record<NotificationKind, string> = {
  game_invite: "envelope-o",
  join_confirmed: "check-circle",
  payment_confirmed: "credit-card",
  result_posted: "flag-checkered",
  rating_updated: "star",
  announcement: "bullhorn",
  verification_update: "shield",
};

export function notificationIcon(kind: string): string {
  return NOTIFICATION_ICONS[kind as NotificationKind] ?? "bell-o";
}

/**
 * Where tapping a notification should land. Returns null when the alert has no
 * target, so the row stays non-tappable rather than going somewhere wrong.
 */
export function notificationTarget(data: Record<string, unknown>): string | null {
  const runId = data.run_id ?? data.runId;
  if (typeof runId === "string" && runId.trim()) return `/session/${runId.trim()}`;

  const screen = data.screen;
  if (typeof screen === "string" && screen.startsWith("/")) return screen;

  const roomId = data.room_id ?? data.roomId;
  if (typeof roomId === "string" && roomId.trim()) return `/(tabs)/messages`;

  return null;
}

/** True when both instants fall on the same local calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export type GroupedNotifications = {
  today: NotificationItem[];
  earlier: NotificationItem[];
};

/** Splits a newest-first list into Today and Earlier, preserving order. */
export function groupNotifications(items: NotificationItem[], now: Date = new Date()): GroupedNotifications {
  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const item of items) {
    const at = new Date(item.createdAt);
    if (!Number.isNaN(at.getTime()) && isSameDay(at, now)) today.push(item);
    else earlier.push(item);
  }
  return { today, earlier };
}

/** "3:40 pm" for today, "Mon" within the week, else "6 Oct". */
export function notificationTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (isSameDay(at, now)) {
    return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  }
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days < 7) return at.toLocaleDateString("en-US", { weekday: "short" });
  return at.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
