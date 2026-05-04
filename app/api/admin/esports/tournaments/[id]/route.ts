import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const STATUSES = new Set(["upcoming", "active", "completed"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const status = String(body.status || "").trim().toLowerCase();
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be upcoming, active, or completed" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("esports_tournaments")
    .update({ status })
    .eq("id", id)
    .select("id,title,game,prize,start_date,end_date,status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  revalidatePath(`/esports/tournaments/${id}`);

  return NextResponse.json({ ok: true, tournament: data });
}
