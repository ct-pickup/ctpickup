import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const id = String(roomId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_room_mutes")
    .select("id,room_id,user_id,muted_by,muted_until,reason,created_at")
    .eq("room_id", id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mutes: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const id = String(roomId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const user_id = String(body.user_id || "").trim();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const rawUntil = body.muted_until == null || body.muted_until === "" ? null : String(body.muted_until);
  const muted_until = rawUntil ? new Date(rawUntil).toISOString() : null;
  const reason = body.reason == null || body.reason === "" ? null : String(body.reason).trim();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_room_mutes")
    .upsert(
      {
        room_id: id,
        user_id,
        muted_by: guard.userId,
        muted_until,
        reason,
      },
      { onConflict: "room_id,user_id" },
    )
    .select("id,room_id,user_id,muted_by,muted_until,reason,created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mute: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const id = String(roomId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const url = new URL(req.url);
  const user_id = String(url.searchParams.get("user_id") || "").trim();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const del = await admin.from("chat_room_mutes").delete().eq("room_id", id).eq("user_id", user_id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

