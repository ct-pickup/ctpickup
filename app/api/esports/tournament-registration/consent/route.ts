import { NextResponse } from "next/server";
import {
  esportsDocVersionLabel,
} from "@/lib/legal/esportsDocVersions";
import {
  esportsConfirmationsComplete,
  type EsportsConfirmations,
} from "@/lib/esports/esportsRegistrationConfirmations";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const server = await supabaseServer();
    const user = await getAuthUserSafe(server);
    if (!user) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
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

    const svc = supabaseService();

    const { data: tournament, error: tErr } = await svc
      .from("esports_tournaments")
      .select("id,status")
      .eq("id", tournamentId)
      .in("status", ["upcoming", "active"])
      .maybeSingle();

    if (tErr || !tournament) {
      return NextResponse.json({ error: "Tournament not open for registration." }, { status: 404 });
    }

    const { data: existing } = await svc
      .from("esports_tournament_registrations")
      .select("id,payment_status")
      .eq("user_id", user.id)
      .eq("tournament_id", tournamentId)
      .maybeSingle();

    if (existing?.payment_status === "paid") {
      return NextResponse.json({ error: "You are already registered and paid for this event." }, { status: 409 });
    }

    const userAgent = req.headers.get("user-agent");
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor?.split(",")[0]?.trim() || null;
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
      tournament_id: tournamentId,
      signed_full_name: signedFullName,
      doc_version_official_rules: esportsDocVersionLabel.officialRules,
      doc_version_terms: esportsDocVersionLabel.participantTerms,
      doc_version_privacy_publicity: esportsDocVersionLabel.privacyPublicity,
      confirmations: confirmations as EsportsConfirmations,
      consent_ip_address: ip,
      consent_user_agent: userAgent,
      consent_recorded_at: now,
      auth_email: user.email ?? null,
      updated_at: now,
      ...resetIfUnpaid,
    };

    if (existing) {
      const { data: updated, error: upErr } = await svc
        .from("esports_tournament_registrations")
        .update(row)
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (upErr || !updated) {
        console.error("esports consent update:", upErr?.message);
        return NextResponse.json({ error: "Could not update consent." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, registration_id: updated.id });
    }

    const { data: inserted, error: insErr } = await svc
      .from("esports_tournament_registrations")
      .insert(row)
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("esports consent insert:", insErr?.message);
      return NextResponse.json({ error: "Could not record consent." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, registration_id: inserted.id });
  } catch (e) {
    console.error("esports consent route:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
