import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

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
  const blocker_user_id = authUser.user.id;

  const bodyJson = await req.json().catch(() => null);
  const blocked_user_id = String(bodyJson?.blocked_user_id || "").trim();
  if (!blocked_user_id) {
    return NextResponse.json({ error: "blocked_user_id required" }, { status: 400 });
  }
  if (blocked_user_id === blocker_user_id) {
    return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 });
  }

  // Upsert so a duplicate tap is idempotent — the unique constraint on
  // (blocker_user_id, blocked_user_id) still enforces "one block per user".
  const ins = await admin
    .from("chat_blocks")
    .upsert(
      { blocker_user_id, blocked_user_id },
      { onConflict: "blocker_user_id,blocked_user_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, block_id: ins.data?.id ?? null });
}
