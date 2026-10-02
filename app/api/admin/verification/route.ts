import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

function writeFailed(phase: string, err: unknown) {
  Sentry.captureException(err);
  console.error(`[admin/verification POST] ${phase}`, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

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

  const reviewed = await admin
    .from("verification_requests")
    .update({ status: decision, reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", request_id);
  if (reviewed.error) return writeFailed("verification_requests update", reviewed.error);

  if (decision === "approved") {
    const prof = await admin.from("profiles").update({ verification_level: "document" }).eq("id", vr.user_id);
    if (prof.error) return writeFailed("profiles update", prof.error);
    const rating = await admin.from("player_ratings")
      .upsert({ user_id: vr.user_id, verification: "document", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (rating.error) return writeFailed("player_ratings upsert", rating.error);
  }

  return NextResponse.json({ ok: true });
}
