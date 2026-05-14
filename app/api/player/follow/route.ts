import { NextResponse } from "next/server";
import { EMPTY_PROFILE_ROW, profileDisplayName } from "@/lib/profileFields";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function followersCount(admin: ReturnType<typeof getSupabaseAdmin>, profileId: string) {
  const res = await admin
    .from("player_follows")
    .select("id", { count: "exact", head: true })
    .eq("following_id", profileId);
  return res.count ?? 0;
}

async function followingCount(admin: ReturnType<typeof getSupabaseAdmin>, profileId: string) {
  const res = await admin
    .from("player_follows")
    .select("id", { count: "exact", head: true })
    .eq("follower_id", profileId);
  return res.count ?? 0;
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const profileId = String(url.searchParams.get("profile_id") || "").trim();
  if (!profileId || !UUID_RE.test(profileId)) {
    return NextResponse.json({ error: "profile_id required" }, { status: 400 });
  }

  const exists = await admin.from("profiles").select("id").eq("id", profileId).maybeSingle();
  if (!exists.data?.id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const [followers_count, following_count, existingFollow] = await Promise.all([
    followersCount(admin, profileId),
    followingCount(admin, profileId),
    admin
      .from("player_follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", profileId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    followers_count,
    following_count,
    is_following: !!existingFollow.data?.id,
  });
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { following_id?: unknown };
  try {
    body = (await req.json()) as { following_id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const followingId = typeof body.following_id === "string" ? body.following_id.trim() : "";
  if (!followingId || !UUID_RE.test(followingId)) {
    return NextResponse.json({ error: "following_id required" }, { status: 400 });
  }
  if (followingId === user.id) {
    return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
  }

  const target = await admin.from("profiles").select("id").eq("id", followingId).maybeSingle();
  if (!target.data?.id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const existing = await admin
    .from("player_follows")
    .select("id")
    .eq("follower_id", user.id)
    .eq("following_id", followingId)
    .maybeSingle();

  let following: boolean;
  if (existing.data?.id) {
    const del = await admin.from("player_follows").delete().eq("id", existing.data.id);
    if (del.error) {
      console.error("[player/follow] unfollow failed:", del.error.message);
      return NextResponse.json({ error: "Could not update follow" }, { status: 500 });
    }
    following = false;
  } else {
    const ins = await admin.from("player_follows").insert({
      follower_id: user.id,
      following_id: followingId,
    });
    if (ins.error) {
      console.error("[player/follow] follow failed:", ins.error.message);
      return NextResponse.json({ error: "Could not update follow" }, { status: 500 });
    }
    following = true;

    const me = await admin
      .from("profiles")
      .select("first_name,last_name,username")
      .eq("id", user.id)
      .maybeSingle();
    const row = me.data as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
    const name =
      profileDisplayName(
        row
          ? {
              ...EMPTY_PROFILE_ROW,
              first_name: row.first_name ?? null,
              last_name: row.last_name ?? null,
              username: row.username ?? null,
            }
          : null,
      ).trim() ||
      (typeof row?.username === "string" && row.username.trim() ? `@${row.username.trim()}` : "") ||
      "A player";

    await sendPushToUsers(admin, [followingId], {
      title: "New follower",
      body: `${name} started following you`,
      data: { kind: "player_follow", follower_id: user.id },
    });
  }

  const followers_count = await followersCount(admin, followingId);

  return NextResponse.json({ ok: true, following, followers_count });
}
