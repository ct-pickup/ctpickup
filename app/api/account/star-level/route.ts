import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { isStarLevel } from "@/shared/starLevels";

export const runtime = "nodejs";

/**
 * "What's the highest level you've played?" Stores the answer and, while the player is
 * provisional, seeds their starting rating via seed_star_level_from_signup (service role only).
 * The response never includes score or the applied level.
 */
export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (authErr || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { level?: unknown };
  try {
    body = (await req.json()) as { level?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const level = typeof body.level === "string" ? Number(body.level) : body.level;
  if (!isStarLevel(level)) return NextResponse.json({ error: "Pick a level." }, { status: 400 });

  const { error } = await admin.rpc("seed_star_level_from_signup", { p_user_id: userId, p_level: level });
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return NextResponse.json({ error: "Levels aren't available yet." }, { status: 503 });
  }
  if (error) {
    Sentry.captureException(new Error(`[account/star-level] ${error.message}`));
    console.error("[account/star-level] seed failed", error);
    return NextResponse.json({ error: "Couldn't save your level. Try again in a moment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
