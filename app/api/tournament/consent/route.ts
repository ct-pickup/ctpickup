import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";

const AGREEMENT_TITLE = "Tournament Rules and Eligibility";
const AGREEMENT_TEXT = `
Captains and players must submit their entry at least 48 hours before the tournament start time.
Team spots are limited. Once the maximum number of teams is reached, the tournament is considered full.
The count can change as submissions are approved or removed.
Once the tournament is full, additional teams will not be included.
Minimum roster size is required to submit a team. The goalkeeper does count toward your minimum player total.
Claiming a captain spot does not fully confirm your team. Final approval depends on payment, roster verification, eligibility, and admin review.
`.trim();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const full_name = String(body?.full_name || "").trim();
    const signed_name = String(body?.signed_name || full_name || "").trim();
    const page = String(body?.page || "/tournament").trim();
    const consent_version = String(body?.consent_version || "tournament_rules_v1").trim();

    if (!full_name) {
      return NextResponse.json({ error: "Missing full_name" }, { status: 400 });
    }

    const server = await supabaseServer();
    const user = await getAuthUserSafe(server);

    if (!user) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
    }

    const userAgent = req.headers.get("user-agent");
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor?.split(",")[0]?.trim() || null;

    const supabase = supabaseService();

    const { error } = await supabase.from("tournament_consents").insert({
      user_id: user.id,
      auth_email: user.email ?? null,
      full_name,
      signed_name,
      page,
      consent_version,
      agreement_title: AGREEMENT_TITLE,
      agreement_text: AGREEMENT_TEXT,
      agreed: true,
      ip_address: ip,
      user_agent: userAgent,
    });

    if (error) {
      console.error("tournament consent insert error:", error);
      return NextResponse.json({ error: "Failed to record consent" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      user_id: user.id,
      auth_email: user.email ?? null,
    });
  } catch (err) {
    console.error("tournament consent route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
