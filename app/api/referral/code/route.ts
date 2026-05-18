import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/referral/auth";
import { ensureProfileReferralCode } from "@/lib/referral/ensureReferralCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { code, error } = await ensureProfileReferralCode(auth.admin, auth.user.id);
  if (error || !code) {
    return NextResponse.json({ error: error || "Could not load referral code." }, { status: 500 });
  }

  return NextResponse.json({ referral_code: code });
}
