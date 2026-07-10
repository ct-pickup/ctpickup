import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

const VALID_TIERS = ["bronze", "silver", "gold", "platinum", "diamond"];
const VALID_VERIF = ["self", "document", "vouched"];

const TIER_SCORE: Record<string, number> = {
  bronze: 30, silver: 50, gold: 65, platinum: 82, diamond: 93,
};

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { user_id, tier, verification } = await req.json() as {
    user_id: string;
    tier?: string;
    verification?: string;
  };

  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  if (tier && !VALID_TIERS.includes(tier)) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  if (verification && !VALID_VERIF.includes(verification)) return NextResponse.json({ error: "Invalid verification" }, { status: 400 });

  const now = new Date().toISOString();
  const ratingUpdate: Record<string, unknown> = { user_id, updated_at: now };
  if (tier) ratingUpdate.score = TIER_SCORE[tier];
  if (verification) ratingUpdate.verification = verification;

  await admin.from("player_ratings").upsert(ratingUpdate, { onConflict: "user_id" });

  if (verification) {
    await admin.from("profiles").update({ verification_level: verification }).eq("id", user_id);
  }

  return NextResponse.json({ ok: true });
}
