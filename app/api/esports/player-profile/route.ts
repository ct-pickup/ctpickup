import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit, requestIp } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function normState(s: string): string {
  return s.trim().toUpperCase();
}

type Body = {
  legal_name?: string;
  contact_email?: string;
  state?: string;
  platform?: "playstation" | "xbox";
  psn_id?: string | null;
  xbox_gamertag?: string | null;
  ea_account?: string | null;
  date_of_birth?: string | null; // YYYY-MM-DD
  affirmed_18_plus?: boolean;
};

export async function GET() {
  const server = await supabaseServer();
  const user = await getAuthUserSafe(server);
  if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

  const { data, error } = await server
    .from("esports_player_profiles")
    .select(
      "id,user_id,legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,date_of_birth,affirmed_18_plus,created_at,updated_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[api/esports/player-profile] GET query failed:", error.message);
    return NextResponse.json({ error: "Could not load profile." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, profile: data ?? null });
}

export async function POST(req: Request) {
  try {
    const server = await supabaseServer();
    const user = await getAuthUserSafe(server);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const ip = requestIp(req);
    const rl = checkRateLimit({
      key: `esports_player_profile:${user.id}:${ip}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again soon." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const body = (await req.json()) as Body;

    const legalName = String(body?.legal_name || "").trim();
    const contactEmail = String(body?.contact_email || user.email || "").trim().toLowerCase();
    const state = normState(String(body?.state || ""));
    const platform = body?.platform === "xbox" ? "xbox" : body?.platform === "playstation" ? "playstation" : null;

    const psnId = String(body?.psn_id || "").trim() || null;
    const xboxGamertag = String(body?.xbox_gamertag || "").trim() || null;
    const eaAccount = String(body?.ea_account || "").trim() || null;
    const affirmed18 = body?.affirmed_18_plus === true;
    const dobRaw = String(body?.date_of_birth || "").trim() || null;

    if (!legalName || legalName.length < 3) {
      return NextResponse.json({ error: "Legal name is required." }, { status: 400 });
    }
    if (!contactEmail || !contactEmail.includes("@")) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!state || state.length < 2) {
      return NextResponse.json({ error: "State is required." }, { status: 400 });
    }
    if (state === "CT") {
      return NextResponse.json({ error: "No CT residents are allowed." }, { status: 400 });
    }
    if (!platform) {
      return NextResponse.json({ error: "Platform is required." }, { status: 400 });
    }
    if (platform === "playstation" && !psnId) {
      return NextResponse.json({ error: "PSN ID is required for PlayStation." }, { status: 400 });
    }
    if (platform === "xbox" && !xboxGamertag) {
      return NextResponse.json({ error: "Xbox gamertag is required for Xbox." }, { status: 400 });
    }
    if (!affirmed18 && !dobRaw) {
      return NextResponse.json({ error: "Confirm you are 18+ or provide date of birth." }, { status: 400 });
    }

    const now = new Date().toISOString();

    const row = {
      user_id: user.id,
      legal_name: legalName,
      contact_email: contactEmail,
      state,
      platform,
      psn_id: platform === "playstation" ? psnId : null,
      xbox_gamertag: platform === "xbox" ? xboxGamertag : null,
      ea_account: eaAccount,
      date_of_birth: dobRaw,
      affirmed_18_plus: affirmed18,
      updated_at: now,
    };

    const { data: existing, error: exErr } = await server
      .from("esports_player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (exErr) {
      console.error("[api/esports/player-profile] POST existing lookup failed:", exErr.message);
      return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
    }

    if (existing?.id) {
      const { data, error } = await server
        .from("esports_player_profiles")
        .update(row)
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select(
          "id,user_id,legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,date_of_birth,affirmed_18_plus,created_at,updated_at",
        )
        .single();
      if (error) {
        console.error("[api/esports/player-profile] POST update failed:", error.message);
        return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
      }
      return NextResponse.json({ ok: true, profile: data });
    }

    const { data, error } = await server
      .from("esports_player_profiles")
      .insert({ ...row, created_at: now })
      .select(
        "id,user_id,legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,date_of_birth,affirmed_18_plus,created_at,updated_at",
      )
      .single();

    if (error) {
      console.error("[api/esports/player-profile] POST insert failed:", error.message);
      return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, profile: data });
  } catch (e) {
    console.error("[api/esports/player-profile] Unhandled error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

