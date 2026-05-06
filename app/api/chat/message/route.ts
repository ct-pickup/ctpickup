import { NextResponse } from "next/server";
import { TEAM_CHAT_SLUG } from "@/lib/chat/constants";
import { truncatePushBody } from "@/lib/push/truncatePushBody";
import { fetchApprovedUserIds } from "@/lib/push/approvedUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type RoomRow = {
  id: string;
  slug: string;
  title: string;
  room_type: string | null;
  announcements_only: boolean;
  is_active: boolean;
  closes_at: string | null;
};

function roomEffectivelyClosed(room: RoomRow): boolean {
  if (!room.is_active) return true;
  if (room.closes_at && new Date(room.closes_at).getTime() <= Date.now()) return true;
  return false;
}

function displayNameFromProfile(p: { first_name?: string | null; last_name?: string | null } | null): string {
  const n = `${String(p?.first_name || "").trim()} ${String(p?.last_name || "").trim()}`.trim();
  return n || "Player";
}

export async function POST(req: Request) {
  const anon = getSupabaseAnon();
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authUser, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !authUser?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = authUser.user.id;

  const bodyJson = await req.json().catch(() => null);
  const room_id = String(bodyJson?.room_id || "").trim();
  const body = String(bodyJson?.body || "").trim();
  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const profRes = await admin.from("profiles").select("approved,is_admin,first_name,last_name").eq("id", uid).maybeSingle();
  if (profRes.error) return NextResponse.json({ error: profRes.error.message }, { status: 500 });
  const profile = profRes.data as { approved?: boolean; is_admin?: boolean; first_name?: string | null; last_name?: string | null } | null;
  const isAdmin = profile?.is_admin === true;
  const approved = profile?.approved === true;
  if (!isAdmin && !approved) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roomRes = await admin
    .from("chat_rooms")
    .select("id,slug,title,room_type,announcements_only,is_active,closes_at")
    .eq("id", room_id)
    .maybeSingle();

  if (roomRes.error) return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
  const room = roomRes.data as RoomRow | null;
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (room.announcements_only && !isAdmin) {
    return NextResponse.json({ error: "Only staff can post in this room" }, { status: 403 });
  }

  if (roomEffectivelyClosed(room) && !isAdmin) {
    return NextResponse.json({ error: "Room is closed" }, { status: 403 });
  }

  if (room.room_type === "group") {
    const mem = await admin.from("chat_room_members").select("user_id").eq("room_id", room_id).eq("user_id", uid).maybeSingle();
    if (mem.error) return NextResponse.json({ error: mem.error.message }, { status: 500 });
    if (!mem.data && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const muteRes = await admin
    .from("chat_room_mutes")
    .select("muted_until")
    .eq("room_id", room_id)
    .eq("user_id", uid)
    .maybeSingle();

  if (muteRes.error) return NextResponse.json({ error: muteRes.error.message }, { status: 500 });
  const mu = muteRes.data as { muted_until?: string | null } | null;
  if (mu && (mu.muted_until == null || new Date(mu.muted_until).getTime() > Date.now())) {
    return NextResponse.json({ error: "You are muted in this room" }, { status: 403 });
  }

  const ins = await admin
    .from("chat_messages")
    .insert({ room_id, user_id: uid, body })
    .select("id,room_id,user_id,body,sender_display_name,created_at")
    .single();

  if (ins.error) {
    const msg = ins.error.message || "";
    const st = /profanity/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: st });
  }

  const row = ins.data as {
    id: string;
    sender_display_name: string;
    body: string;
  };

  const title = truncatePushBody(row.sender_display_name || displayNameFromProfile(profile), 80);
  const pushBody = truncatePushBody(row.body);

  let pushTargetIds: string[] = [];

  if (room.room_type === "group") {
    const mem = await admin.from("chat_room_members").select("user_id").eq("room_id", room_id);
    if (!mem.error) {
      pushTargetIds = (mem.data ?? [])
        .map((r) => (r as { user_id?: string }).user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0 && id !== uid);
    }
  } else if (room.slug === TEAM_CHAT_SLUG) {
    const idsRes = await fetchApprovedUserIds(admin);
    if (!("error" in idsRes)) {
      pushTargetIds = idsRes.ids.filter((id) => id !== uid);
    }
  }

  if (pushTargetIds.length > 0) {
    await sendPushToUsers(admin, pushTargetIds, {
      title,
      body: pushBody,
      data: { kind: "chat_message", room_id: room.id, room_slug: room.slug, message_id: row.id },
    });
  }

  return NextResponse.json({ ok: true, message: ins.data });
}
