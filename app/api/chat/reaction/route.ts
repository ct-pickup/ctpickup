import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type RoomRow = {
  id: string;
  slug: string;
  room_type: string | null;
  is_active: boolean;
  closes_at: string | null;
  auto_close_at: string | null;
};

function roomEffectivelyClosed(room: RoomRow): boolean {
  if (!room.is_active) return true;
  if (room.closes_at && new Date(room.closes_at).getTime() <= Date.now()) return true;
  return false;
}

function runBanterReactionClosed(room: RoomRow, isAdmin: boolean): boolean {
  if (isAdmin) return false;
  if (room.room_type !== "run_banter") return false;
  if (!room.auto_close_at) return false;
  return new Date(room.auto_close_at).getTime() <= Date.now();
}

export type ReactionGroup = { emoji: string; count: number; reacted_by_me: boolean };

function aggregateReactions(rows: { emoji: string; user_id: string }[] | null, myUserId: string): ReactionGroup[] {
  const byEmoji = new Map<string, { count: number; reacted_by_me: boolean }>();
  for (const r of rows ?? []) {
    const e = String(r.emoji || "").trim();
    if (!e) continue;
    const cur = byEmoji.get(e) ?? { count: 0, reacted_by_me: false };
    cur.count += 1;
    if (r.user_id === myUserId) cur.reacted_by_me = true;
    byEmoji.set(e, cur);
  }
  return [...byEmoji.entries()]
    .map(([emoji, v]) => ({ emoji, count: v.count, reacted_by_me: v.reacted_by_me }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
}

type AuthMsgOk = { uid: string; messageId: string; roomId: string; isAdmin: boolean };

async function authorizeMessageAccess(
  admin: ReturnType<typeof getSupabaseAdmin>,
  anon: ReturnType<typeof getSupabaseAnon>,
  token: string,
  messageId: string,
): Promise<{ ok: true; data: AuthMsgOk } | { ok: false; status: number; error: string }> {
  const { data: authUser, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !authUser?.user?.id) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const uid = authUser.user.id;

  const profRes = await admin.from("profiles").select("approved,is_admin").eq("id", uid).maybeSingle();
  if (profRes.error) return { ok: false, status: 500, error: profRes.error.message };
  const profile = profRes.data as { approved?: boolean; is_admin?: boolean } | null;
  const isAdmin = profile?.is_admin === true;
  const approved = profile?.approved === true;
  if (!isAdmin && !approved) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const msgRes = await admin.from("chat_messages").select("id,room_id").eq("id", messageId).maybeSingle();
  if (msgRes.error) return { ok: false, status: 500, error: msgRes.error.message };
  const message = msgRes.data as { id: string; room_id: string } | null;
  if (!message) return { ok: false, status: 404, error: "Message not found" };

  const roomRes = await admin
    .from("chat_rooms")
    .select("id,slug,room_type,is_active,closes_at,auto_close_at")
    .eq("id", message.room_id)
    .maybeSingle();
  if (roomRes.error) return { ok: false, status: 500, error: roomRes.error.message };
  const room = roomRes.data as RoomRow | null;
  if (!room) return { ok: false, status: 404, error: "Room not found" };

  if (roomEffectivelyClosed(room) && !isAdmin) {
    return { ok: false, status: 403, error: "Room is closed" };
  }

  if (runBanterReactionClosed(room, isAdmin)) {
    return { ok: false, status: 403, error: "This chat has closed." };
  }

  if (room.room_type === "group" || room.room_type === "run_banter" || room.room_type === "tournament_team") {
    const mem = await admin
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", message.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (mem.error) return { ok: false, status: 500, error: mem.error.message };
    if (!mem.data && !isAdmin) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }

  return { ok: true, data: { uid, messageId: message.id, roomId: message.room_id, isAdmin } };
}

function normalizeEmoji(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.length > 32) return null;
  return s;
}

export async function POST(req: Request) {
  const anon = getSupabaseAnon();
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bodyJson = await req.json().catch(() => null);
  const message_id = String(bodyJson?.message_id || "").trim();
  const emoji = normalizeEmoji(bodyJson?.emoji);
  if (!message_id) return NextResponse.json({ error: "message_id required" }, { status: 400 });
  if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 });

  const gate = await authorizeMessageAccess(admin, anon, token, message_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { uid } = gate.data;

  const existing = await admin
    .from("chat_reactions")
    .select("id")
    .eq("message_id", message_id)
    .eq("user_id", uid)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });

  if (existing.data?.id) {
    const del = await admin.from("chat_reactions").delete().eq("id", existing.data.id);
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  } else {
    const ins = await admin.from("chat_reactions").insert({ message_id, user_id: uid, emoji });
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  const list = await admin.from("chat_reactions").select("emoji,user_id").eq("message_id", message_id);
  if (list.error) return NextResponse.json({ error: list.error.message }, { status: 500 });

  const reactions = aggregateReactions(list.data as { emoji: string; user_id: string }[], uid);
  return NextResponse.json({ ok: true, reactions });
}

export async function GET(req: Request) {
  const anon = getSupabaseAnon();
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const message_id = String(url.searchParams.get("message_id") || "").trim();
  if (!message_id) return NextResponse.json({ error: "message_id required" }, { status: 400 });

  const gate = await authorizeMessageAccess(admin, anon, token, message_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { uid } = gate.data;

  const list = await admin.from("chat_reactions").select("emoji,user_id").eq("message_id", message_id);
  if (list.error) return NextResponse.json({ error: list.error.message }, { status: 500 });

  const reactions = aggregateReactions(list.data as { emoji: string; user_id: string }[], uid);
  return NextResponse.json({ reactions });
}
