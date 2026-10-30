import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { track } from "@/lib/analytics/analytics";
import { routeForPushData } from "@/lib/pushRouting";

/**
 * Opens the right screen when the player or an admin taps a field-request push (cold start, background or foreground).
 * Waits for sign-in and the admin flag so an admin tap is never mistaken for a player's, and handles each push once.
 */
export function PushTapRouter() {
  const router = useRouter();
  const { session, isReady: authReady } = useAuth();
  const { isAdmin, isReady: adminReady } = useProfileAdmin();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!last || !authReady || !session || !adminReady) return;
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    trackPushOpened(last.notification.request.content.data);
    const href = routeForPushData(last.notification.request.content.data, { isAdmin });
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      /* older runtimes: the handled ref still prevents a repeat */
    }
    if (href) router.push(href);
  }, [last, authReady, session, adminReady, isAdmin, router]);

  return null;
}

/** Which push was opened, by the id the server put in it. The id and kind are short tokens: nothing from the message text. */
function trackPushOpened(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const d = data as { push_id?: unknown; kind?: unknown };
  const props: Record<string, string> = {};
  if (typeof d.push_id === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(d.push_id)) props.push_id = d.push_id;
  if (typeof d.kind === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(d.kind)) props.kind = d.kind;
  track("push_opened", props);
}
