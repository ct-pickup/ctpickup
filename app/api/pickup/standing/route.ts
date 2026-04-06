import { NextResponse } from "next/server";
import { computePickupReliability } from "@/lib/pickup/standing/reliabilityScore";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function GET(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 200 });
  }

  const admin = getSupabaseAdmin();

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 200 });
  }

  const profRes = await admin
    .from("profiles")
    .select("id,first_name,last_name,instagram,confirmed_count,attended_count,strike_count")
    .eq("id", user.id)
    .maybeSingle();

  if (profRes.error || !profRes.data) {
    return NextResponse.json({ ok: false, authenticated: true }, { status: 200 });
  }

  const prof = profRes.data;

  const lateRes = await admin
    .from("pickup_reliability_incidents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", "late_cancel");

  const lateCancels = lateRes.count ?? 0;

  const confirmed = Number(prof.confirmed_count || 0);
  const attended = Number(prof.attended_count || 0);
  const noShows = Number(prof.strike_count || 0);

  const reliability = computePickupReliability({
    confirmed,
    attended,
    lateCancels,
    noShows,
  });

  const userLabel =
    reliability.trackedPickups < 3 || reliability.scorePct == null
      ? "Building rating"
      : reliability.bucket === "good"
        ? "Good Standing"
        : "Reliability";

  const userSubtext =
    reliability.trackedPickups < 3 || reliability.scorePct == null
      ? "Rating starts after 3 pickups"
      : `${Math.round(reliability.scorePct)}% reliability over tracked pickups`;

  return NextResponse.json({
    ok: true,
    authenticated: true,
    reliability: {
      tracked_pickups: reliability.trackedPickups,
      score_pct: reliability.scorePct,
      bucket: reliability.bucket,
      user_label: userLabel,
      user_subtext: userSubtext,
      confirmed_count: confirmed,
      attended_count: attended,
      no_show_count: noShows,
      late_cancel_count: lateCancels,
    },
    profile: {
      first_name: prof.first_name,
      last_name: prof.last_name,
      instagram: prof.instagram,
    },
  });
}

