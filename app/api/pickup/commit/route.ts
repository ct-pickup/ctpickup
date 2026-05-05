import { NextResponse } from "next/server";
import { assertPickupStandingAllowsParticipation } from "@/lib/pickup/standing/participationGate";
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

  const standingGate = await assertPickupStandingAllowsParticipation(admin, userId);
  if (!standingGate.ok) {
    return NextResponse.json(
      { error: standingGate.code, detail: standingGate.detail },
      { status: 403 },
    );
  }

  const body = await req.json();
  const run_id = String(body.run_id || "");
  const slot_id_in = body.slot_id ? String(body.slot_id) : null;
  const slot_label_in =
    typeof body.slot_label === "string" && body.slot_label.trim().length > 0
      ? body.slot_label.trim()
      : null;
  const state = String(body.state || "declined"); // 'available' | 'declined'

  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  if (state === "available" && !slot_id_in && !slot_label_in)
    return NextResponse.json({ error: "Missing slot_id or slot_label" }, { status: 400 });

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

  // Resolve target slot_id. If `slot_label` was supplied, look up an existing
  // slot with that label for this run; otherwise create one so availability has
  // a stable slot to attach to. Falling back keeps callers that still send
  // `slot_id` working unchanged.
  let resolvedSlotId: string | null = null;
  if (state === "available") {
    if (slot_id_in) {
      resolvedSlotId = slot_id_in;
    } else if (slot_label_in) {
      const existing = await admin
        .from("pickup_run_time_slots")
        .select("id")
        .eq("run_id", run_id)
        .eq("label", slot_label_in)
        .limit(1)
        .maybeSingle();

      if (existing.data?.id) {
        resolvedSlotId = String(existing.data.id);
      } else {
        const ins = await admin
          .from("pickup_run_time_slots")
          .insert({
            run_id,
            label: slot_label_in,
            start_at: run.data.start_at ?? null,
          })
          .select("id")
          .maybeSingle();

        if (ins.error || !ins.data?.id) {
          return NextResponse.json(
            { error: ins.error?.message || "Could not create slot for label." },
            { status: 500 },
          );
        }
        resolvedSlotId = String(ins.data.id);
      }
    }
  }

  // Upsert availability
  await admin.from("pickup_run_availability").upsert(
    {
      run_id,
      user_id: userId,
      slot_id: state === "available" ? resolvedSlotId : null,
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
