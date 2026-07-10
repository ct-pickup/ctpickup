import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { request_id, decision } = await req.json() as { request_id: string; decision: "approved" | "rejected" };

  if (!request_id || !["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data: vr } = await admin
    .from("verification_requests")
    .select("user_id")
    .eq("id", request_id)
    .maybeSingle();

  if (!vr) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  await admin
    .from("verification_requests")
    .update({ status: decision, reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", request_id);

  if (decision === "approved") {
    await admin.from("profiles").update({ verification_level: "document" }).eq("id", vr.user_id);
    await admin.from("player_ratings")
      .upsert({ user_id: vr.user_id, verification: "document", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  }

  return NextResponse.json({ ok: true });
}
