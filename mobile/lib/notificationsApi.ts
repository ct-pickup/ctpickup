import { siteOrigin } from "@/lib/env";
import type { NotificationsResponse } from "@shared/notifications";

/** Plain-words failure the Notifications screen can show as-is. */
export class NotificationsRequestError extends Error {}

const OFFLINE = "We could not reach the server. Check your connection and try again.";

export async function fetchNotifications(accessToken: string): Promise<NotificationsResponse> {
  const origin = siteOrigin();
  if (!origin) throw new NotificationsRequestError(OFFLINE);

  let res: Response;
  try {
    res = await fetch(`${origin}/api/notifications`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new NotificationsRequestError(OFFLINE);
  }

  const json = (await res.json().catch(() => null)) as (NotificationsResponse & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new NotificationsRequestError(
      typeof json?.error === "string" ? json.error : "We could not load your notifications right now.",
    );
  }
  return { items: Array.isArray(json.items) ? json.items : [], unread: Number(json.unread ?? 0) };
}

/** Moves the read watermark to now. Returns the message to show if it did not work. */
export async function markNotificationsRead(accessToken: string): Promise<void> {
  const origin = siteOrigin();
  if (!origin) throw new NotificationsRequestError(OFFLINE);

  let res: Response;
  try {
    res = await fetch(`${origin}/api/notifications`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch {
    throw new NotificationsRequestError(OFFLINE);
  }

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new NotificationsRequestError(
      typeof json?.error === "string" ? json.error : "We could not mark those as read.",
    );
  }
}
