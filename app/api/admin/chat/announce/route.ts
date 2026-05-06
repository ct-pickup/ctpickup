import { NextResponse } from "next/server";
import { staffInsertChatMessageAndPush } from "@/lib/chat/staffInsertChatMessageAndPush";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type Body = {
  room_id?: string;
  room_slug?: string;
  message?: string;
};

type RoomRow = {
  id: string;
  slug: string;
  title: string;
  room_type: string | null;
  announcements_only: boolean;
  is_active: boolean;
  closes_at: string | null;
};

const ROOM_SELECT = "id,slug,title,room_type,announcements_only,is_active,closes_at";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Body | null;
  const roomIdInput = String(body?.room_id || "").trim();
  const roomSlugInput = String(body?.room_slug || "").trim();
  const message = String(body?.message || "").trim();

  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (roomIdInput && !isUuid(roomIdInput)) {
    return NextResponse.json({ error: "room_id must be a uuid" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  let room: RoomRow | null = null;
  if (roomIdInput) {
    const r = await admin.from("chat_rooms").select(ROOM_SELECT).eq("id", roomIdInput).maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    room = (r.data as RoomRow | null) ?? null;
  } else {
    const slug = roomSlugInput || "announcements";
    const r = await admin.from("chat_rooms").select(ROOM_SELECT).eq("slug", slug).maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    room = (r.data as RoomRow | null) ?? null;
  }

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const isGroup = room.room_type === "group";

  if (!isGroup && !room.announcements_only) {
    return NextResponse.json({ error: "Room must be announcement or group" }, { status: 409 });
  }

  const { insertError, push } = await staffInsertChatMessageAndPush(admin, guard.userId, room, message);
  if (insertError) return NextResponse.json({ error: insertError }, { status: 500 });
  if (!push) return NextResponse.json({ error: "push_failed" }, { status: 500 });
  if (push.lookupError) {
    return NextResponse.json({ error: push.lookupError }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    room_id: room.id,
    room_slug: room.slug,
    room_type: room.room_type,
    pushed: push.tokens,
    push_batches: push.batches,
  });
}
