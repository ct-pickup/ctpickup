import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/referral/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.admin
    .from("pickup_credits")
    .select("id,reason,amount_cents,discount_pct,awarded_at,expires_at,used_at")
    .eq("user_id", auth.user.id)
    .order("awarded_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message || "Could not load credits." }, { status: 500 });
  }

  const now = Date.now();
  const credits = (data || []).map((row) => {
    const expiresAt = String(row.expires_at || "");
    const usedAt = row.used_at != null ? String(row.used_at) : null;
    const isUsed = usedAt != null;
    const isExpired = !isUsed && expiresAt.length > 0 && new Date(expiresAt).getTime() <= now;
    return {
      id: row.id,
      reason: row.reason,
      amount_cents: row.amount_cents,
      discount_pct: row.discount_pct,
      awarded_at: row.awarded_at,
      expires_at: row.expires_at,
      used_at: row.used_at,
      is_expired: isExpired,
      is_used: isUsed,
    };
  });

  return NextResponse.json({ credits });
}
