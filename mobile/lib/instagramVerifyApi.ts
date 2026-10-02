import * as Sentry from "@sentry/react-native";

import { siteOrigin } from "@/lib/env";
import {
  VERIFICATION_UNAVAILABLE_MESSAGE,
  type InstagramVerificationQueueItem,
  type InstagramVerificationState,
} from "@shared/instagramVerification";

export type VerifyResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; unavailable: boolean };

const FALLBACK = "Something went wrong. Try again in a moment.";

/** The server already returns friendly copy in `error`; anything else goes to Sentry, not the screen. */
async function call<T>(accessToken: string, path: string, body?: unknown): Promise<VerifyResult<T>> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, status: 0, error: FALLBACK, unavailable: false };
  try {
    const r = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await r.json().catch(() => null)) as { error?: unknown; unavailable?: unknown } | null;
    if (r.ok) return { ok: true, data: json as T };
    const unavailable = json?.unavailable === true;
    const error = unavailable
      ? VERIFICATION_UNAVAILABLE_MESSAGE
      : typeof json?.error === "string" && json.error
        ? json.error
        : r.status === 401
          ? "Sign in again to continue."
          : FALLBACK;
    if (r.status >= 500 && !unavailable) {
      Sentry.captureMessage(`instagram verification ${path} failed`, { level: "error", extra: { status: r.status, json } });
    }
    return { ok: false, status: r.status, error, unavailable };
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "instagram_verification" }, extra: { path } });
    return { ok: false, status: 0, error: "Couldn't reach CT Pickup. Check your connection and try again.", unavailable: false };
  }
}

export function fetchInstagramVerification(accessToken: string) {
  return call<InstagramVerificationState>(accessToken, "/api/account/instagram-verification");
}

export function requestInstagramCode(accessToken: string, handle: string) {
  return call<InstagramVerificationState>(accessToken, "/api/account/instagram-verification", { handle });
}

export function setShowInstagram(accessToken: string, show: boolean) {
  return call<{ show_instagram: boolean }>(accessToken, "/api/account/instagram-visibility", { show });
}

export function fetchInstagramQueue(accessToken: string) {
  return call<{ items: InstagramVerificationQueueItem[] }>(accessToken, "/api/admin/instagram-verification");
}

export function approveInstagramRequest(accessToken: string, requestId: string, code: string) {
  return call<{ ok: true }>(accessToken, "/api/admin/instagram-verification", {
    request_id: requestId,
    decision: "approve",
    code,
  });
}

export function rejectInstagramRequest(accessToken: string, requestId: string, reason: string) {
  return call<{ ok: true }>(accessToken, "/api/admin/instagram-verification", {
    request_id: requestId,
    decision: "reject",
    reason,
  });
}
