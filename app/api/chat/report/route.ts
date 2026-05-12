import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const ALLOWED_REASONS = new Set(["harassment", "spam", "inappropriate", "other"]);

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
  const reporter_user_id = authUser.user.id;

  const bodyJson = await req.json().catch(() => null);
  const message_id = String(bodyJson?.message_id || "").trim();
  const reasonRaw = String(bodyJson?.reason || "").trim().toLowerCase();
  if (!message_id) return NextResponse.json({ error: "message_id required" }, { status: 400 });
  if (!ALLOWED_REASONS.has(reasonRaw)) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }

  const msgRes = await admin
    .from("chat_messages")
    .select("id,room_id,user_id")
    .eq("id", message_id)
    .maybeSingle();
  if (msgRes.error) return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
  const message = msgRes.data as { id: string; room_id: string; user_id: string } | null;
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  if (message.user_id === reporter_user_id) {
    return NextResponse.json({ error: "Cannot report your own message" }, { status: 400 });
  }

  const ins = await admin
    .from("chat_reports")
    .insert({
      reporter_user_id,
      reported_user_id: message.user_id,
      message_id: message.id,
      room_id: message.room_id,
      reason: reasonRaw,
    })
    .select("id")
    .single();

  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, report_id: ins.data?.id ?? null });
}
