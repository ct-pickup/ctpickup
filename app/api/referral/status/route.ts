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

  const countRes = await auth.admin
    .from("referral_events")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", auth.user.id);

  const referralsCount = countRes.count ?? 0;

  const now = new Date().toISOString();
  const { data: creditRows, error: creditsErr } = await auth.admin
    .from("pickup_credits")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("reason", "referral")
    .is("used_at", null)
    .gt("expires_at", now);

  if (creditsErr) {
    return NextResponse.json({ error: creditsErr.message || "Could not load credits." }, { status: 500 });
  }

  let credits = (creditRows || []).length;

  const { data: prof } = await auth.admin
    .from("profiles")
    .select("referral_credits")
    .eq("id", auth.user.id)
    .maybeSingle();

  const legacy = Number(prof?.referral_credits ?? 0);
  if (Number.isFinite(legacy) && legacy > 0) {
    credits += legacy;
  }

  return NextResponse.json({
    referral_code: code,
    referrals_count: referralsCount,
    credits: Math.max(0, credits),
  });
}
