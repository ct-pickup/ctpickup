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

  const { code, error: codeErr } = await ensureProfileReferralCode(auth.admin, auth.user.id);
  if (codeErr || !code) {
    return NextResponse.json({ error: codeErr || "Could not load referral code." }, { status: 500 });
  }

  const { data: prof, error: profErr } = await auth.admin
    .from("profiles")
    .select("referral_credits")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profErr) {
    return NextResponse.json({ error: profErr.message || "Could not load profile." }, { status: 500 });
  }

  const countRes = await auth.admin
    .from("referral_events")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", auth.user.id);

  const referralsCount = countRes.count ?? 0;
  const credits = Number(prof?.referral_credits ?? 0);

  return NextResponse.json({
    referral_code: code,
    referrals_count: referralsCount,
    credits: Number.isFinite(credits) ? Math.max(0, credits) : 0,
  });
}
