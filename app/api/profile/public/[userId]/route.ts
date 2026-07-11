import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { displayRegionNameFromZip } from "@/lib/zipRegion";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { serviceRegionName } from "@/lib/serviceRegions";
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
      "id,first_name,last_name,username,avatar_url,instagram,tier,tier_rank,playing_position,plays_goalie,approved,is_admin,zip_code,nearest_venue,verification_level,primary_position,secondary_positions,experience_level,date_of_birth,club_name,roster_url,attended_count",
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

  const fromZip = displayRegionNameFromZip(
    typeof p.zip_code === "string" ? p.zip_code : p.zip_code != null ? String(p.zip_code) : null,
  );
  const venueRegion = serviceRegionForVenueName(
    typeof p.nearest_venue === "string" ? p.nearest_venue : null,
  );
  const region = fromZip ?? (venueRegion ? serviceRegionName(venueRegion) : null);

  // Get tier from player_ratings if available (more accurate than profile column)
  const { data: rating } = await admin
    .from("player_ratings")
    .select("tier, verification, score, sessions, reliability")
    .eq("user_id", targetId)
    .maybeSingle();

  function ageFromDob(dob: string | null): number | null {
    if (!dob) return null;
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age > 0 && age < 100 ? age : null;
  }

  return NextResponse.json({
    id: p.id,
    display_name: fullName(p.first_name, p.last_name),
    username: p.username?.trim() || null,
    avatar_url: p.avatar_url?.trim() || null,
    instagram: p.instagram?.trim() || null,
    tier: rating?.tier ?? p.tier ?? null,
    tier_rank: p.tier_rank === null || p.tier_rank === undefined ? null : Number(p.tier_rank),
    playing_position: p.playing_position?.trim() || null,
    plays_goalie: typeof p.plays_goalie === "boolean" ? p.plays_goalie : null,
    region,
    verification_level: p.verification_level ?? "self",
    verification: rating?.verification ?? "self",
    primary_position: p.primary_position ?? null,
    secondary_positions: Array.isArray(p.secondary_positions) ? p.secondary_positions : [],
    experience_level: p.experience_level ?? null,
    age: ageFromDob(typeof p.date_of_birth === "string" ? p.date_of_birth : null),
    club_name: p.club_name ?? null,
    roster_url: p.roster_url ?? null,
    rating_sessions: rating?.sessions ?? 0,
    reliability: rating?.reliability ?? null,
    attended_count: typeof p.attended_count === "number" ? p.attended_count : null,
  });
}
