import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseGuidancePlan,
  validateGuidanceMessage,
  validateSportFocus,
} from "@/lib/guidanceRequest";
import { profileDisplayName, type ProfileRow } from "@/lib/profileFields";
import { SUPPORT_EMAIL_ADDRESS } from "@/lib/supportEmail";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json(
        { error: "Guidance requests are not configured." },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Sign in to submit a guidance request." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const plan = body && parseGuidancePlan(body.plan);
    const msgErr =
      body && typeof body === "object" && "message" in body
        ? validateGuidanceMessage((body as { message: unknown }).message)
        : "Invalid request.";
    const sportRaw =
      body && typeof body === "object" && "sport_focus" in body
        ? (body as { sport_focus: unknown }).sport_focus
        : "";
    const sportErr = validateSportFocus(sportRaw);

    if (!plan || msgErr || sportErr) {
      return NextResponse.json(
        { error: msgErr || sportErr || "Choose a plan and add a message." },
        { status: 400 }
      );
    }

    const message = String(
      (body as { message: unknown }).message ?? ""
    ).trim();
    const sport_focus = String(sportRaw ?? "").trim() || null;

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      return NextResponse.json(
        { error: "Sign in to submit a guidance request." },
        { status: 401 }
      );
    }

    const userId = userRes.user.id;
    const email = userRes.user.email?.trim() || null;

    const waiverOk = await userHasAcceptedCurrentWaiver(userId);
    if (!waiverOk) {
      return NextResponse.json(
        { error: "waiver_required" },
        { status: 403 }
      );
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("first_name,last_name,tier")
      .eq("id", userId)
      .maybeSingle();

    const row = prof as ProfileRow | null;
    const submitter_name = profileDisplayName(row) || null;
    const profile_tier_snapshot = row?.tier?.trim() || null;

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      plan,
      message,
      status: "pending",
      submitter_name,
      submitter_email: email,
      profile_tier_snapshot,
      sport_focus,
    };

    const { data, error } = await supabase
      .from("guidance_requests")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[guidance/request]", error.message);
      return NextResponse.json(
        {
          error: `Could not save your request. If this keeps happening, email ${SUPPORT_EMAIL_ADDRESS}.`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      id: data?.id,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
