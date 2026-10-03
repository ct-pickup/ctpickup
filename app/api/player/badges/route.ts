import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/admin/requireAdmin";
import { loadPlayerBadges } from "@/lib/records/playerBadges";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the caller's profile badges as `{ id, earned }` in catalog order (shared/badges.ts). */
export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const badges = await loadPlayerBadges(admin, userId);
    return NextResponse.json({ ok: true, user_id: userId, badges });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[player/badges] failed:", msg);
    return NextResponse.json({ error: "Could not load badges." }, { status: 500 });
  }
}
