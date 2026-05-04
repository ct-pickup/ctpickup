import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function GET(_req: Request) {
  const guard = await requireAdminBearer(_req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("esports_tournaments")
    .select(
      "id,title,game,prize,start_date,end_date,status,description,format_summary,created_at",
    )
    .order("start_date", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tournaments: data ?? [] });
}
