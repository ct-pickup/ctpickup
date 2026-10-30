export type AlertType = "slot_opens" | "request_updates" | "new_games" | "changes_cancellations" | "weekly_roundup";

export const ALERT_OPTIONS: { type: AlertType; title: string; sub: string; defaultOn: boolean; /** Not sent by the server yet, so not shown. */ hidden?: boolean }[] = [
  { type: "slot_opens", title: "Slot opens at saved fields", sub: "When a booked time frees up", defaultOn: true },
  { type: "request_updates", title: "My request updates", sub: "Approved, declined or needs info", defaultOn: true },
  { type: "new_games", title: "New games near me", sub: "Pickup games within 10 miles", defaultOn: true },
  { type: "changes_cancellations", title: "Changes and cancellations", sub: "If a field closes or a game moves", defaultOn: true },
  { type: "weekly_roundup", title: "Weekly roundup", sub: "Free fields and games each Thursday", defaultOn: false, hidden: true },
];

/** The alert switches the screen shows. weekly_roundup stays out until the server can send it. */
export const VISIBLE_ALERT_OPTIONS = ALERT_OPTIONS.filter((o) => !o.hidden);

/**
 * A player with no row for an alert gets its default. request_updates defaults on and the server treats a missing row as on,
 * so the toggle always matches what the server will do.
 */
export function alertEnabled(rows: { alert_type: string; enabled: boolean }[], type: AlertType): boolean {
  const hit = rows.find((r) => r.alert_type === type);
  if (hit) return hit.enabled;
  return ALERT_OPTIONS.find((o) => o.type === type)?.defaultOn ?? false;
}
