import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });

  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

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
