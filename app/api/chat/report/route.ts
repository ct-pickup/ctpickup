import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const ALLOWED_REASONS = new Set(["harassment", "spam", "inappropriate", "other", "impersonation"]);

/** Client may send human-readable labels from the profile report UI. */
const PROFILE_REASON_LABEL_TO_SLUG: Record<string, string> = {
  "inappropriate profile": "inappropriate",
  "harassment or abuse": "harassment",
  "fake or impersonation": "impersonation",
  spam: "spam",
};

function normalizeReason(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (ALLOWED_REASONS.has(key)) return key;
  return PROFILE_REASON_LABEL_TO_SLUG[key] ?? null;
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
  const reporter_user_id = authUser.user.id;

  const bodyJson = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const rawMessageId = bodyJson?.message_id;
  const message_id =
    rawMessageId === null || rawMessageId === undefined || rawMessageId === ""
      ? null
      : String(rawMessageId).trim();

  const reasonRaw = String(bodyJson?.reason ?? "").trim();
  const reasonNorm = normalizeReason(reasonRaw);
  if (!reasonNorm) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }

  if (!message_id) {
    const reported_user_id = String(bodyJson?.reported_user_id ?? "").trim();
    if (!reported_user_id) {
      return NextResponse.json({ error: "reported_user_id required" }, { status: 400 });
    }
    if (reported_user_id === reporter_user_id) {
      return NextResponse.json({ error: "Cannot report yourself" }, { status: 400 });
    }

    const profRes = await admin.from("profiles").select("id").eq("id", reported_user_id).maybeSingle();
    if (profRes.error) return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    if (!profRes.data) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const ins = await admin
      .from("chat_reports")
      .insert({
        reporter_user_id,
        reported_user_id,
        message_id: null,
        room_id: null,
        reason: reasonNorm,
      })
      .select("id")
      .single();

    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, report_id: ins.data?.id ?? null });
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
      reason: reasonNorm,
    })
    .select("id")
    .single();

  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, report_id: ins.data?.id ?? null });
}
