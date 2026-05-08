import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const svc = supabaseService();

  const sugRes = await svc
    .from("tier_promotion_suggestions")
    .select("id,user_id,current_tier,suggested_tier,reason,runs_attended,attendance_rate,no_show_count,created_at,reviewed,accepted")
    .eq("reviewed", false)
    .order("created_at", { ascending: false })
    .limit(250);

  if (sugRes.error) {
    console.error("[admin/tier-suggestions] list:", sugRes.error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const suggestions = sugRes.data || [];
  const userIds = Array.from(new Set(suggestions.map((s: any) => String(s.user_id))));

  const profRes = userIds.length
    ? await svc.from("profiles").select("id,first_name,last_name,instagram,tier,tier_rank").in("id", userIds)
    : { data: [] as any[], error: null as any };

  if ((profRes as any).error) {
    console.error("[admin/tier-suggestions] profiles:", (profRes as any).error.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  type ProfileLite = {
    id?: string | number | null;
    first_name?: string | null;
    last_name?: string | null;
    instagram?: string | null;
    tier?: string | null;
    tier_rank?: number | null;
  };

  const profBy = new Map<string, ProfileLite>(((profRes as any).data || []).map((p: any) => [String(p.id), p]));

  const rows = suggestions.map((s: any) => {
    const p = profBy.get(String(s.user_id)) || null;
    const full_name = p ? `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim() || "Player" : "Player";
    return {
      ...s,
      profile: p
        ? {
            id: String(p.id),
            full_name,
            instagram: p.instagram ?? null,
            tier: p.tier ?? null,
            tier_rank: p.tier_rank ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, suggestions: rows, pending_count: rows.length });
}

