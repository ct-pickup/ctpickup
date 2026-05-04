import { NextResponse } from "next/server";
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

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

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

  // Resolve target room: prefer room_id, then room_slug, then fall back to legacy "announcements" slug.
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

  // Announce-only and Group rooms are both valid push targets. Public rooms are not.
  if (!isGroup && !room.announcements_only) {
    return NextResponse.json(
      { error: "Room must be announcement or group" },
      { status: 409 },
    );
  }

  const ins = await admin.from("chat_messages").insert({
    room_id: room.id,
    user_id: guard.userId,
    body: message,
  });
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  // Build push token list. Group rooms only push to members; otherwise everyone with a token.
  let tokens: string[] = [];

  if (isGroup) {
    const mem = await admin
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", room.id);
    if (mem.error) return NextResponse.json({ error: mem.error.message }, { status: 500 });

    const userIds = (mem.data ?? [])
      .map((r) => (r as { user_id?: string }).user_id)
      .filter((u): u is string => typeof u === "string" && u.length > 0);

    if (userIds.length > 0) {
      const tokensRes = await admin
        .from("user_push_devices")
        .select("expo_push_token,user_id")
        .in("user_id", userIds)
        .limit(4000);
      if (tokensRes.error) {
        return NextResponse.json({ error: tokensRes.error.message }, { status: 500 });
      }
      tokens = (tokensRes.data ?? [])
        .map((r) => (r as { expo_push_token?: unknown }).expo_push_token)
        .filter((t): t is string => typeof t === "string" && t.length > 10);
    }
  } else {
    const tokensRes = await admin
      .from("user_push_devices")
      .select("expo_push_token")
      .limit(4000);
    if (tokensRes.error) {
      return NextResponse.json({ error: tokensRes.error.message }, { status: 500 });
    }
    tokens = (tokensRes.data ?? [])
      .map((r) => (r as { expo_push_token?: unknown }).expo_push_token)
      .filter((t): t is string => typeof t === "string" && t.length > 10);
  }

  const title = room.title || "CT Pickup";
  const bodyText = truncate(message, 160);

  // Expo accepts up to 100 messages per request; chunk.
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100));

  const pushResults: { ok: boolean; status?: number; error?: string }[] = [];

  for (const chunk of chunks) {
    const payload = chunk.map((to) => ({
      to,
      title,
      body: bodyText,
      sound: "default",
      data: { kind: "announcement", room_slug: room.slug, room_id: room.id, room_type: room.room_type },
    }));

    try {
      const r = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        pushResults.push({ ok: false, status: r.status, error: j ? JSON.stringify(j) : "push_failed" });
      } else {
        pushResults.push({ ok: true, status: r.status });
      }
    } catch (e: unknown) {
      pushResults.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    room_id: room.id,
    room_slug: room.slug,
    room_type: room.room_type,
    pushed: tokens.length,
    push_batches: pushResults,
  });
}
