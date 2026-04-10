import { NextResponse } from "next/server";
import {
  esportsDocVersionLabel,
} from "@/lib/legal/esportsDocVersions";
import {
  esportsConfirmationsComplete,
  type EsportsConfirmations,
} from "@/lib/esports/esportsRegistrationConfirmations";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit, requestIp } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const server = await supabaseServer();
    const user = await getAuthUserSafe(server);
    if (!user) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
    }

    const ip = requestIp(req);
    const rl = checkRateLimit({
      key: `esports_consent:${user.id}:${ip}`,
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again soon." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const body = await req.json();
    const tournamentId = String(body?.tournament_id || "").trim();
    const signedFullName = String(body?.signed_full_name || "").trim();
    const confirmations = body?.confirmations as Partial<EsportsConfirmations> | undefined;

    if (!tournamentId) {
      return NextResponse.json({ error: "Missing tournament_id." }, { status: 400 });
    }
    if (signedFullName.length < 3) {
      return NextResponse.json({ error: "Enter your full legal name as your electronic signature." }, { status: 400 });
    }
    if (!esportsConfirmationsComplete(confirmations)) {
      return NextResponse.json({ error: "All confirmations are required." }, { status: 400 });
    }

    const { data: playerProfile, error: pErr } = await server
      .from("esports_player_profiles")
      .select("id,affirmed_18_plus,date_of_birth,platform,psn_id,xbox_gamertag,legal_name,contact_email,state")
      .eq("user_id", user.id)
      .maybeSingle();

    if (pErr || !playerProfile?.id) {
      return NextResponse.json(
        { error: "Complete your esports player profile before signing and paying." },
        { status: 403 },
      );
    }

    const { data: tournament, error: tErr } = await server
      .from("esports_tournaments")
      .select("id,status")
      .eq("id", tournamentId)
      .in("status", ["upcoming", "active"])
      .maybeSingle();

    if (tErr || !tournament) {
      return NextResponse.json({ error: "Tournament not open for registration." }, { status: 404 });
    }

    const { data: existing, error: exErr } = await server
      .from("esports_tournament_registrations")
      .select("id,payment_status")
      .eq("user_id", user.id)
      .eq("tournament_id", tournamentId)
      .maybeSingle();
    if (exErr) {
      console.error("[api/esports/consent] existing lookup failed:", exErr.message);
      return NextResponse.json({ error: "Could not record consent." }, { status: 500 });
    }

    if (existing?.payment_status === "paid") {
      return NextResponse.json({ error: "You are already registered and paid for this event." }, { status: 409 });
    }

    const userAgent = req.headers.get("user-agent");
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ipAddr = forwardedFor?.split(",")[0]?.trim() || null;
    const now = new Date().toISOString();

    const resetIfUnpaid =
      existing && existing.payment_status !== "paid"
        ? {
            payment_status: "unpaid" as const,
            stripe_checkout_session_id: null as string | null,
            stripe_payment_intent_id: null as string | null,
            paid_at: null as string | null,
          }
        : {};

    const row = {
      user_id: user.id,
      esports_player_profile_id: playerProfile.id,
      tournament_id: tournamentId,
      signed_full_name: signedFullName,
      doc_version_official_rules: esportsDocVersionLabel.officialRules,
      doc_version_terms: esportsDocVersionLabel.participantTerms,
      doc_version_privacy_publicity: esportsDocVersionLabel.privacyPublicity,
      confirmations: confirmations as EsportsConfirmations,
      consent_ip_address: ipAddr,
      consent_user_agent: userAgent,
      consent_recorded_at: now,
      auth_email: user.email ?? null,
      updated_at: now,
      ...resetIfUnpaid,
    };

    if (existing) {
      const { data: updated, error: upErr } = await server
        .from("esports_tournament_registrations")
        .update(row)
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (upErr || !updated) {
        console.error("[api/esports/consent] update failed:", upErr?.message);
        return NextResponse.json({ error: "Could not update consent." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, registration_id: updated.id });
    }

    const { data: inserted, error: insErr } = await server
      .from("esports_tournament_registrations")
      .insert(row)
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("[api/esports/consent] insert failed:", insErr?.message);
      return NextResponse.json({ error: "Could not record consent." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, registration_id: inserted.id });
  } catch (e) {
    console.error("[api/esports/consent] Unhandled error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
