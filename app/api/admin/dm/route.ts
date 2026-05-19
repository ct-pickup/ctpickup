import { NextResponse } from "next/server";
import { adminDmRoomSlug, isAdminDmGroupSlug } from "@/lib/chat/adminDmRoom";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { truncatePushBody } from "@/lib/push/truncatePushBody";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function displayNameFromProfile(p: { first_name?: string | null; last_name?: string | null } | null): string {
  const n = `${String(p?.first_name || "").trim()} ${String(p?.last_name || "").trim()}`.trim();
  return n || "CT Pickup";
}

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const targetUserId = String(url.searchParams.get("user_id") || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(targetUserId)) {
    return NextResponse.json({ error: "user_id required (uuid)" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const slug = adminDmRoomSlug(guard.userId, targetUserId);
  const roomRes = await admin.from("chat_rooms").select("id,slug,room_type").eq("slug", slug).maybeSingle();
  if (roomRes.error) return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
  const row = roomRes.data as { id?: string; slug?: string; room_type?: string } | null;
  if (!row?.id || row.room_type !== "group" || !isAdminDmGroupSlug(row.slug || "")) {
    return NextResponse.json({ ok: true, room_id: null });
  }

  const mem = await admin.from("chat_room_members").select("user_id").eq("room_id", row.id);
  if (mem.error) return NextResponse.json({ error: mem.error.message }, { status: 500 });
  const ids = new Set((mem.data ?? []).map((m) => (m as { user_id?: string }).user_id).filter(Boolean));
  if (!ids.has(guard.userId) || !ids.has(targetUserId)) {
    return NextResponse.json({ ok: true, room_id: null });
  }

  return NextResponse.json({ ok: true, room_id: row.id });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const target_user_id = String(body.target_user_id || "").trim().toLowerCase();
  const message = String(body.message || "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target_user_id)) {
    return NextResponse.json({ error: "target_user_id must be a uuid" }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (target_user_id === guard.userId) {
    return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const targetProf = await admin
    .from("profiles")
    .select("id")
    .eq("id", target_user_id)
    .maybeSingle();
  if (targetProf.error) return NextResponse.json({ error: targetProf.error.message }, { status: 500 });
  if (!targetProf.data?.id) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const adminProf = await admin
    .from("profiles")
    .select("first_name,last_name")
    .eq("id", guard.userId)
    .maybeSingle();
  const adminTitle = displayNameFromProfile(
    adminProf.data as { first_name?: string | null; last_name?: string | null } | null,
  );

  const slug = adminDmRoomSlug(guard.userId, target_user_id);

  let roomId: string;
  const existing = await admin.from("chat_rooms").select("id,slug,room_type").eq("slug", slug).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  const ex = existing.data as { id?: string; slug?: string; room_type?: string } | null;

  if (ex?.id && ex.room_type === "group" && isAdminDmGroupSlug(ex.slug || "")) {
    roomId = ex.id;
  } else if (ex?.id) {
    return NextResponse.json({ error: "Slug conflict with non-DM room" }, { status: 409 });
  } else {
    const insRoom = await admin
      .from("chat_rooms")
      .insert({
        slug,
        title: adminTitle,
        room_type: "group",
        announcements_only: false,
        is_active: true,
        created_by: guard.userId,
      })
      .select("id")
      .single();
    if (insRoom.error || !insRoom.data?.id) {
      return NextResponse.json({ error: insRoom.error?.message || "Failed to create room" }, { status: 500 });
    }
    roomId = insRoom.data.id as string;
  }

  const memberRows = [
    { room_id: roomId, user_id: guard.userId, added_by: guard.userId },
    { room_id: roomId, user_id: target_user_id, added_by: guard.userId },
  ];
  const memUpsert = await admin.from("chat_room_members").upsert(memberRows, { onConflict: "room_id,user_id" });
  if (memUpsert.error) {
    return NextResponse.json({ error: memUpsert.error.message }, { status: 500 });
  }

  const insMsg = await admin
    .from("chat_messages")
    .insert({ room_id: roomId, user_id: guard.userId, body: message })
    .select("id,room_id,user_id,body,sender_display_name,sender_is_admin,created_at")
    .single();

  if (insMsg.error) {
    const msg = insMsg.error.message || "";
    const st = /profanity/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: st });
  }

  const row = insMsg.data as {
    id: string;
    sender_display_name: string;
    body: string;
  };

  const pushTitle = truncatePushBody(row.sender_display_name || adminTitle, 80);
  const pushBody = "You have a new message from CT Pickup";
  await sendPushToUsers(admin, [target_user_id], {
    title: pushTitle,
    body: pushBody,
    data: {
      kind: "chat_message",
      room_id: roomId,
      room_slug: slug,
      message_id: row.id,
    },
  });

  return NextResponse.json({
    ok: true,
    room_id: roomId,
    room_slug: slug,
    message: insMsg.data,
  });
}
