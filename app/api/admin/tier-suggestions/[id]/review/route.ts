import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

function tierRankFromLabel(label: string | null | undefined): number {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return 6;
  if (s.includes("1a")) return 1;
  if (s.includes("1b")) return 2;
  if (s.includes("tier 2") || s === "t2") return 3;
  if (s.includes("tier 3") || s === "t3") return 4;
  if (s.includes("tier 4") || s === "t4") return 5;
  if (s.includes("public")) return 6;
  return 6;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const suggestionId = String(id || "").trim();
  if (!suggestionId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const accepted = body?.accepted === true;

  const svc = supabaseService();

  const sugRes = await svc
    .from("tier_promotion_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();

  if (sugRes.error) return NextResponse.json({ error: sugRes.error.message }, { status: 500 });
  const sug = sugRes.data as any;
  if (!sug) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sug.reviewed) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });

  const nowIso = new Date().toISOString();

  if (accepted) {
    const rank = tierRankFromLabel(sug.suggested_tier);
    const up = await svc
      .from("profiles")
      .update({
        tier: sug.suggested_tier,
        tier_rank: rank,
        updated_at: nowIso,
      })
      .eq("id", String(sug.user_id));

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  }

  const review = await svc
    .from("tier_promotion_suggestions")
    .update({
      reviewed: true,
      accepted,
      reviewed_at: nowIso,
      reviewed_by: gate.userId,
    })
    .eq("id", suggestionId);

  if (review.error) return NextResponse.json({ error: review.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, accepted });
}

