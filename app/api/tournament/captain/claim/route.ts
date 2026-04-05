import { NextResponse } from "next/server";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const anon = getSupabaseAnon();

  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const waiverOk = await userHasAcceptedCurrentWaiver(u.user.id);
  if (!waiverOk) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const userId = u.user.id;

  // active tournament
  const { data: t } = await admin
    .from("tournaments")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!t) return NextResponse.json({ error: "no_active_tournament" }, { status: 404 });

  // upsert captain slot (1 per user per tournament)
  const { data: cap, error: capErr } = await admin
    .from("tournament_captains")
    .upsert(
      {
        tournament_id: t.id,
        user_id: userId,
        status: "reserved",
        players_paid: 0,
      },
      { onConflict: "tournament_id,user_id" }
    )
    .select("*")
    .single();

  if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });

  return NextResponse.json({ captain: cap });
}
