import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ACTIVE_CLAIM_STATUSES = [
  "claim_submitted",
  "payment_pending",
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
  "confirmed",
];

async function expireOverduePaymentHolds(tournamentId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("tournament_captains")
    .update({ status: "released_expired" })
    .eq("tournament_id", tournamentId)
    .eq("status", "payment_pending")
    .lt("payment_due_at", now);
}

export async function GET() {
  const { data: t, error: tErr } = await supabase
    .from("tournaments")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (tErr || !t) return NextResponse.json({ error: "no_active_tournament" }, { status: 404 });

  await expireOverduePaymentHolds(t.id);

  const { data: captains, error: cErr } = await supabase
    .from("tournament_captains")
    .select("status")
    .eq("tournament_id", t.id);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const claimedTeams = (captains || []).filter((c) => ACTIVE_CLAIM_STATUSES.includes(c.status)).length;
  const confirmedTeams = (captains || []).filter((c) => c.status === "confirmed").length;

  const official = confirmedTeams >= t.official_threshold; // 8
  const full = confirmedTeams >= t.max_teams; // 12

  return NextResponse.json({
    tournament: {
      id: t.id,
      slug: t.slug,
      title: t.title,
      targetTeams: t.target_teams,
      officialThreshold: t.official_threshold,
      maxTeams: t.max_teams,
    },
    claimedTeams,
    confirmedTeams,
    official,
    full,
  });
}
