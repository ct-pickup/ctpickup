import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const svc = supabaseService();
  const { data: rows, error } = await svc
    .from("user_waiver_acceptance")
    .select("id,user_id,version,accepted_at")
    .order("accepted_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[admin/waiver-acceptances]", error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const userIds = [...new Set((rows || []).map((r) => r.user_id))];
  type Prof = {
    first_name: string | null;
    last_name: string | null;
    instagram: string | null;
  };
  const profiles: Record<string, Prof> = {};

  if (userIds.length) {
    const { data: profs } = await svc
      .from("profiles")
      .select("id,first_name,last_name,instagram")
      .in("id", userIds);

    for (const p of profs || []) {
      const row = p as Prof & { id: string };
      profiles[row.id] = {
        first_name: row.first_name,
        last_name: row.last_name,
        instagram: row.instagram,
      };
    }
  }

  const enriched = (rows || []).map((r) => ({
    ...r,
    profile: profiles[r.user_id] ?? null,
  }));

  return NextResponse.json({
    currentWaiverVersion: CURRENT_WAIVER_VERSION,
    rows: enriched,
  });
}
