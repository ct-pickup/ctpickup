import { Platform } from "react-native";

import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { appVersion } from "@/lib/appVersionHeader";
import { siteOrigin } from "@/lib/env";
import { createAnalytics, type QueuedEvent, type SendResult } from "@/lib/analytics/analyticsCore";

async function send(token: string, body: { session_id: string; platform: string; app_version: string; events: QueuedEvent[] }): Promise<SendResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, status: 0 };
  try {
    const r = await fetch(`${origin}/api/analytics/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** The one queue for the app. Nothing is recorded until AnalyticsProvider switches it on. */
export const analytics = createAnalytics({
  storage: appAsyncStorage,
  send,
  platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web",
  appVersion: appVersion(),
});

/** Fire and forget. Never throws, never blocks a screen. Property values are short tokens, numbers or booleans: no names, no text. */
export function track(name: string, properties?: Record<string, string | number | boolean>): void {
  void analytics.track(name, properties).catch(() => undefined);
}
