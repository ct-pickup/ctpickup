import { NextResponse } from "next/server";

import { requireFlag } from "@/lib/flags";
import { parsePushSettingsUpdate, readPushSettings, savePushSettings } from "@/lib/push/pushSettings";
import { requireAuthedUser } from "@/lib/referral/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mobile/push-settings: the signed-in player's category switches and quiet hours. Behind the 'notification_settings' flag. */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "notification_settings", auth.user.id);
  if (off) return off;
  return NextResponse.json({ ok: true, settings: await readPushSettings(auth.admin, auth.user.id) });
}

/**
 * POST /api/mobile/push-settings  { categories?: { games, reminders, results, chat, fields, marketing }, quiet?: { enabled, start, end, timezone } }
 * start and end are minutes after midnight in the player's time zone. Behind the 'notification_settings' flag.
 */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "notification_settings", auth.user.id);
  if (off) return off;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const parsed = parsePushSettingsUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const saved = await savePushSettings(auth.admin, auth.user.id, parsed.update);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ ok: true, settings: await readPushSettings(auth.admin, auth.user.id) });
}
