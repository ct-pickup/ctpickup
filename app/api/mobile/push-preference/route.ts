import { NextResponse } from "next/server";
import {
  canPersistPushToken,
  parseInstallationContext,
  registerUserPushDevice,
} from "@/lib/push/registerUserPushDevice";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "mobile/push-preference";

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

/**
 * Persists the user's push notification opt-out (App Store Guideline 4.5.4).
 *
 * - enabled=false: profile is flipped off AND every `user_push_devices` row
 *   for this user is deleted so Expo Push can no longer reach the device.
 * - enabled=true:  profile is flipped on; if the client also passes the
 *   current Expo push token, it's upserted (matches the existing logic in
 *   /api/mobile/push-token) so the user starts receiving pushes again
 *   immediately without waiting for the next cold start.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "server_config", detail: msg }, { status: 500 });
  }

  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const u = await admin.auth.getUser(token);
  if (u.error || !u.data.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const userId = u.data.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const enabledRaw = (body as { enabled?: unknown }).enabled;
  if (typeof enabledRaw !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid_enabled" }, { status: 400 });
  }
  const enabled = enabledRaw;

  const expoPushTokenRaw = (body as { expo_push_token?: unknown }).expo_push_token;
  const expoPushToken = typeof expoPushTokenRaw === "string" ? expoPushTokenRaw.trim() : "";
  const platformRaw = (body as { platform?: unknown }).platform;
  const platformVal = typeof platformRaw === "string" ? platformRaw.trim().toLowerCase() : "";
  const platform = platformVal === "ios" || platformVal === "android" ? platformVal : null;
  const installationContext = parseInstallationContext(
    (body as { installation_context?: unknown }).installation_context,
  );

  const profUpdate = await admin
    .from("profiles")
    .update({ push_notifications_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (profUpdate.error) {
    console.error(`[api/${ROUTE}] profile update:`, profUpdate.error.message);
    return NextResponse.json({ ok: false, error: "persist_failed" }, { status: 500 });
  }

  if (!enabled) {
    const del = await admin.from("user_push_devices").delete().eq("user_id", userId);
    if (del.error) {
      console.error(`[api/${ROUTE}] device delete:`, del.error.message);
      return NextResponse.json({ ok: false, error: "persist_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, enabled: false });
  }

  if (expoPushToken.length >= 16 && platform) {
    if (!canPersistPushToken(installationContext)) {
      console.warn(
        `[api/${ROUTE}] skipped expo_go token on re-enable`,
        JSON.stringify({ userId, installationContext }),
      );
    } else {
      const reg = await registerUserPushDevice(admin, {
        userId,
        expoPushToken,
        platform,
        pushEnabled: true,
        installationContext,
      });
      if (!reg.ok) {
        console.error(`[api/${ROUTE}] device upsert:`, reg.error);
        return NextResponse.json({ ok: false, error: "persist_failed" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, enabled: true });
}
