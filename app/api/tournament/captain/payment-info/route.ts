import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseAnon } from "@/lib/server/runtimeClients";
import { isPaidOrReadyCaptainStatus } from "@/lib/tournament/outdoorTournamentConstants";
import { loadPaymentConfig } from "@/lib/tournament/paymentConfig";

export const runtime = "nodejs";

/**
 * GET /api/tournament/captain/payment-info?tournament_id=...
 *
 * What the signed-in captain's own payment screen needs when the organizer collects payment outside the app: whether payment is handled
 * in the app or outside it, whether THIS captain's claim has been approved, whether THIS team is marked paid, and the organizer's payment
 * instructions, which are returned ONLY when the tournament collects payment outside the app AND this captain's claim is approved
 * (and not rejected or expired). It never says anything about any other team, and never returns an amount or a record of a payment.
 */
export async function GET(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const anon = getSupabaseAnon();
  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const tournamentId = new URL(req.url).searchParams.get("tournament_id")?.trim() ?? "";
  if (!tournamentId) return NextResponse.json({ error: "missing_tournament_id" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const cfg = await loadPaymentConfig(admin, tournamentId);
  if (!cfg.ok) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const cap = await admin
    .from("tournament_captains")
    .select("status,captain_verified")
    .eq("tournament_id", tournamentId)
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (cap.error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const row = cap.data as { status?: string | null; captain_verified?: boolean | null } | null;

  const status = String(row?.status ?? "");
  const closed = status === "claim_rejected" || status === "released_expired";
  const approved = row?.captain_verified === true && !closed;
  const paid = isPaidOrReadyCaptainStatus(status);

  return NextResponse.json(
    {
      mode: cfg.mode,
      approved,
      paid,
      instructions: cfg.mode === "manual" && approved && !paid ? cfg.instructions : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
