import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { loadTournamentList } from "@/lib/tournament/tournamentList";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Live tournaments for the Home card and the Events tab. Signed-in, approved players and admins only, the same people who may
 * open a bracket. The response is allow-listed in lib/tournament/tournamentList.ts: no team, captain or payment data.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const anon = getSupabaseAnon();
  const { data: authData, error: uErr } = await anon.auth.getUser(token);
  const user = authData?.user;
  if (uErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: prof } = await admin.from("profiles").select("approved,is_admin").eq("id", user.id).maybeSingle();
  if (prof?.approved !== true && prof?.is_admin !== true) {
    return NextResponse.json({ error: "You need an approved account to view tournaments." }, { status: 403 });
  }

  const loaded = await loadTournamentList(admin);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });
  return NextResponse.json({ tournaments: loaded.tournaments }, { headers: { "Cache-Control": "no-store" } });
}
