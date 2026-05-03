import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

type Body = {
  room_slug?: string;
  message?: string;
};

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Body | null;
  const roomSlug = String(body?.room_slug || "announcements").trim();
  const message = String(body?.message || "").trim();

  if (!roomSlug) return NextResponse.json({ error: "room_slug required" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  const admin = getSupabaseAdmin();

  const roomRes = await admin
    .from("chat_rooms")
    .select("id,slug,title,announcements_only,is_active,closes_at")
    .eq("slug", roomSlug)
    .maybeSingle();

  if (!roomRes.data) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!roomRes.data.announcements_only) {
    return NextResponse.json({ error: "Room is not announcements-only" }, { status: 409 });
  }

  const ins = await admin.from("chat_messages").insert({
    room_id: roomRes.data.id,
    user_id: guard.userId,
    body: message,
  });
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  // Fan out Expo push notifications to all registered devices.
  const tokensRes = await admin
    .from("user_push_devices")
    .select("expo_push_token")
    .limit(4000);

  const tokens = (tokensRes.data || [])
    .map((r) => (r as any).expo_push_token)
    .filter((t: unknown) => typeof t === "string" && t.length > 10) as string[];

  const title = roomRes.data.title || "CT Pickup";
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
      data: { kind: "announcement", room_slug: roomSlug },
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
    room_slug: roomSlug,
    pushed: tokens.length,
    push_batches: pushResults,
  });
}

