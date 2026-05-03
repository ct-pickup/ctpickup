import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "mobile/push-token";

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

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

  const expoPushToken = typeof (body as { expo_push_token?: unknown }).expo_push_token === "string"
    ? (body as { expo_push_token: string }).expo_push_token.trim()
    : "";
  const platformRaw = typeof (body as { platform?: unknown }).platform === "string"
    ? (body as { platform: string }).platform.trim().toLowerCase()
    : "";

  if (expoPushToken.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });
  }

  const platform = platformRaw === "ios" || platformRaw === "android" ? platformRaw : null;
  if (!platform) {
    return NextResponse.json({ ok: false, error: "invalid_platform" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { error } = await admin.from("user_push_devices").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      updated_at: now,
    },
    { onConflict: "user_id,expo_push_token" },
  );

  if (error) {
    console.error(`[api/${ROUTE}] upsert:`, error.message);
    return NextResponse.json({ ok: false, error: "persist_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
