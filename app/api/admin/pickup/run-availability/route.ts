import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/** Admin removes a player's availability row for a run (body: { run_id, user_id }). */
export async function DELETE(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const run_id = String(body.run_id || "");
  const user_id = String(body.user_id || "");
  if (!run_id || !user_id) {
    return NextResponse.json({ error: "Missing run_id or user_id" }, { status: 400 });
  }

  const del = await admin.from("pickup_run_availability").delete().eq("run_id", run_id).eq("user_id", user_id);

  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
