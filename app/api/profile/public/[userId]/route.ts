import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "profile/public/[userId]";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

function fullName(first: string | null, last: string | null) {
  const s = `${first ?? ""} ${last ?? ""}`.trim();
  return s || "Player";
}

/**
 * Public player card for in-app social (e.g. team chat). Viewer must be an approved
 * or admin account; target must exist and be approved or admin. No email/phone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "server_config", detail: msg }, { status: 500 });
  }

  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { userId: targetId } = await ctx.params;
  if (!targetId || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
  }

  const authRes = await admin.auth.getUser(token);
  if (authRes.error || !authRes.data.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const viewerId = authRes.data.user.id;

  const viewerProf = await admin
    .from("profiles")
    .select("approved,is_admin")
    .eq("id", viewerId)
    .maybeSingle();

  if (viewerProf.error) {
    console.error(`[api/${ROUTE}] viewer profile:`, viewerProf.error.message);
    return NextResponse.json({ error: "profile_error" }, { status: 500 });
  }

  const canView =
    !!viewerProf.data && (viewerProf.data.approved === true || viewerProf.data.is_admin === true);
  if (!canView) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = await admin
    .from("profiles")
    .select(
      "id,first_name,last_name,username,avatar_url,instagram,tier,tier_rank,playing_position,plays_goalie,approved,is_admin",
    )
    .eq("id", targetId)
    .maybeSingle();

  if (target.error) {
    console.error(`[api/${ROUTE}] target profile:`, target.error.message);
    return NextResponse.json({ error: "profile_error" }, { status: 500 });
  }

  const p = target.data;
  if (!p) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const targetVisible = p.approved === true || p.is_admin === true;
  if (!targetVisible) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: p.id,
    display_name: fullName(p.first_name, p.last_name),
    username: p.username?.trim() || null,
    avatar_url: p.avatar_url?.trim() || null,
    instagram: p.instagram?.trim() || null,
    tier: p.tier ?? null,
    tier_rank: p.tier_rank === null || p.tier_rank === undefined ? null : Number(p.tier_rank),
    playing_position: p.playing_position?.trim() || null,
    plays_goalie: typeof p.plays_goalie === "boolean" ? p.plays_goalie : null,
  });
}
