import { NextResponse } from "next/server";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function isTier1(rank: number | null | undefined) {
  return rank === 1 || rank === 2;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const userId = u.data.user?.id || null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const waiverOk = await userHasAcceptedCurrentWaiver(userId);
  if (!waiverOk) {
    return NextResponse.json({ error: "waiver_required" }, { status: 403 });
  }

  const body = await req.json();
  const run_id = String(body.run_id || "");
  const slot_id = body.slot_id ? String(body.slot_id) : null;
  const state = String(body.state || "declined"); // 'available' | 'declined'

  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  if (state === "available" && !slot_id)
    return NextResponse.json({ error: "Missing slot_id" }, { status: 400 });

  const prof = await admin
    .from("profiles")
    .select("approved, tier_rank")
    .eq("id", userId)
    .maybeSingle();

  if (!prof.data?.approved) {
    return NextResponse.json({ error: "Account pending approval." }, { status: 403 });
  }

  const run = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  if (!run.data) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // Availability only allowed while run is planning/likely_on and not finalized
  if (!["planning", "likely_on"].includes(run.data.status)) {
    return NextResponse.json({ error: "Availability is closed for this run." }, { status: 403 });
  }
  if (run.data.final_slot_id) {
    return NextResponse.json({ error: "Run already finalized." }, { status: 403 });
  }

  // Must be invited (Wave 1 only)
  if (run.data.open_tier_rank === null) {
    return NextResponse.json({ error: "Invites are not open yet." }, { status: 403 });
  }
  const tier_rank = prof.data.tier_rank ?? 6;
  if (tier_rank > run.data.open_tier_rank) {
    return NextResponse.json({ error: "Not invited yet." }, { status: 403 });
  }

  if (run.data.run_type !== "public") {
    const inviteRow = await admin
      .from("pickup_run_invites")
      .select("run_id,user_id")
      .eq("run_id", run_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!inviteRow.data) {
      return NextResponse.json({ error: "Not invited yet." }, { status: 403 });
    }
  }

  // Upsert availability
  await admin.from("pickup_run_availability").upsert(
    {
      run_id,
      user_id: userId,
      slot_id: state === "available" ? slot_id : null,
      state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id" }
  );

  // Recompute likely_on:
  // ≥5 tier1 (tier_rank 1,2) available for same slot
  const availRes = await admin
    .from("pickup_run_availability")
    .select("user_id, slot_id, state")
    .eq("run_id", run_id);

  const av = (availRes.data || []).filter((a) => a.state === "available" && a.slot_id);

  const ids = Array.from(new Set(av.map((a) => a.user_id)));
  const profs = ids.length
    ? await admin.from("profiles").select("id, tier_rank").in("id", ids)
    : { data: [] as any[] };

  const rankMap: Record<string, number> = {};
  for (const p of profs.data || []) rankMap[p.id] = p.tier_rank ?? 6;

  const counts: Record<string, number> = {};
  for (const a of av) {
    const r = rankMap[a.user_id] ?? 6;
    if (!isTier1(r)) continue;
    counts[a.slot_id] = (counts[a.slot_id] || 0) + 1;
  }

  // choose the first slot that hits >=5, preferring highest count
  let winner: string | null = null;
  let best = 0;
  for (const [slot, c] of Object.entries(counts)) {
    if (c >= 5 && c > best) {
      winner = slot;
      best = c;
    }
  }

  if (winner && !run.data.likely_on_slot_id) {
    await admin
      .from("pickup_runs")
      .update({
        status: "likely_on",
        likely_on_at: new Date().toISOString(),
        likely_on_slot_id: winner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run_id);
  }

  return NextResponse.json({ ok: true });
}
