import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 10) / 10;
}

/**
 * Aggregate host ratings for a host. Always returns averages (null when no ratings).
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const host_id = new URL(req.url).searchParams.get("host_id")?.trim() ?? "";
  if (!host_id) {
    return NextResponse.json({ error: "host_id required" }, { status: 400 });
  }

  const { data: rows, error } = await admin
    .from("host_ratings")
    .select("overall,field_secured,organization,player_quality,safety,would_play_again")
    .eq("host_id", host_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = rows ?? [];
  const total_ratings = list.length;

  const { count: sessions_hosted } = await admin
    .from("pickup_runs")
    .select("id", { count: "exact", head: true })
    .eq("created_by", host_id);

  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const take = (key: string) =>
    list
      .map((r) => num((r as Record<string, unknown>)[key]))
      .filter((n): n is number => n != null);

  return NextResponse.json({
    avg_overall: avg(take("overall")),
    avg_field_secured: avg(take("field_secured")),
    avg_organization: avg(take("organization")),
    avg_player_quality: avg(take("player_quality")),
    avg_safety: avg(take("safety")),
    avg_would_play_again: avg(take("would_play_again")),
    total_ratings,
    sessions_hosted: sessions_hosted ?? 0,
  });
}
