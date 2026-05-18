import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/referral/auth";
import { normalizeReferralCodeInput } from "@/lib/referral/referralCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawCode =
    body && typeof body === "object" && "referral_code" in body
      ? (body as { referral_code?: unknown }).referral_code
      : null;

  const code = normalizeReferralCodeInput(
    typeof rawCode === "string" ? rawCode : rawCode == null ? "" : String(rawCode),
  );
  if (!code) {
    return NextResponse.json(
      { error: "Referral code must be 6 letters or numbers." },
      { status: 400 },
    );
  }

  const { data: selfProf, error: selfErr } = await auth.admin
    .from("profiles")
    .select("referral_code,referred_by")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (selfErr || !selfProf) {
    return NextResponse.json({ error: "Could not load profile." }, { status: 400 });
  }

  if (typeof selfProf.referred_by === "string" && selfProf.referred_by.trim()) {
    return NextResponse.json({ error: "A referral code was already applied to your account." }, { status: 409 });
  }

  const ownCode =
    typeof selfProf.referral_code === "string" ? selfProf.referral_code.trim().toUpperCase() : "";
  if (ownCode && ownCode === code) {
    return NextResponse.json({ error: "You cannot use your own referral code." }, { status: 400 });
  }

  const { data: referrer, error: refErr } = await auth.admin
    .from("profiles")
    .select("id,referral_code")
    .eq("referral_code", code)
    .maybeSingle();

  if (refErr) {
    return NextResponse.json({ error: "Could not validate referral code." }, { status: 500 });
  }
  if (!referrer?.id) {
    return NextResponse.json({ error: "Referral code not found." }, { status: 404 });
  }
  if (referrer.id === auth.user.id) {
    return NextResponse.json({ error: "You cannot use your own referral code." }, { status: 400 });
  }

  const { error: updErr } = await auth.admin
    .from("profiles")
    .update({ referred_by: code, updated_at: new Date().toISOString() })
    .eq("id", auth.user.id)
    .is("referred_by", null);

  if (updErr) {
    const dup = /unique|duplicate|23505/i.test(updErr.message ?? "");
    if (dup) {
      return NextResponse.json({ error: "A referral code was already applied to your account." }, { status: 409 });
    }
    return NextResponse.json({ error: updErr.message || "Could not apply referral code." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, referred_by: code });
}
