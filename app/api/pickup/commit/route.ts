import { NextResponse } from "next/server";
import { assertPickupStandingAllowsParticipation } from "@/lib/pickup/standing/participationGate";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { isSelectPickupRunType } from "@/lib/pickup/pickupRunType";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function isTier1(rank: number | null | undefined) {
  return rank === 1 || rank === 2;
}

async function resolveSlotIdFromLabel(
  admin: SupabaseClient,
  run_id: string,
  start_at: string | null,
  slot_label: string,
): Promise<string> {
  const existing = await admin
    .from("pickup_run_time_slots")
    .select("id")
    .eq("run_id", run_id)
    .eq("label", slot_label)
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message || "Could not look up slot for label.");
  }
  if (existing.data?.id != null) {
    return String(existing.data.id);
  }

  const inserted = await admin
    .from("pickup_run_time_slots")
    .insert({ run_id, label: slot_label, start_at })
    .select("id")
    .single();

  if (!inserted.error && inserted.data?.id != null) {
    return String(inserted.data.id);
  }

  const dup =
    inserted.error?.code === "23505" ||
    (inserted.error?.message?.toLowerCase().includes("duplicate") ?? false);

  if (dup) {
    const again = await admin
      .from("pickup_run_time_slots")
      .select("id")
      .eq("run_id", run_id)
      .eq("label", slot_label)
      .maybeSingle();

    if (again.error) {
      throw new Error(again.error.message || "Could not load slot after duplicate insert.");
    }
    if (again.data?.id != null) {
      return String(again.data.id);
    }
  }

  throw new Error(inserted.error?.message || "Could not create slot for label.");
}

async function invitedUserIdsForPickupPush(
  admin: SupabaseClient,
  run_id: string,
  run: { run_type: string; service_region?: string | null },
): Promise<string[]> {
  const profRes = await admin.from("profiles").select("id,nearest_venue").eq("approved", true);

  if (profRes.error || !(profRes.data?.length ?? 0)) return [];

  const inRegion = (profRes.data ?? []).filter((p: { id: string; nearest_venue: string | null }) =>
    profileMatchesRunServiceRegion(p.nearest_venue, run.service_region),
  );

  if (!isSelectPickupRunType(run.run_type)) {
    return inRegion.map((p: { id: string }) => p.id);
  }

  const invRes = await admin.from("pickup_run_invites").select("user_id").eq("run_id", run_id);
  if (invRes.error || !(invRes.data?.length ?? 0)) return [];

  const invited = new Set((invRes.data ?? []).map((r: { user_id: string }) => r.user_id));
  return inRegion.map((p: { id: string }) => p.id).filter((id) => invited.has(id));
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

  const rawSel = body.slot_labels_selection;
  const slot_labels_selection = Array.isArray(rawSel)
    ? Array.from(
        new Set(
          rawSel
            .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
            .filter((s: string) => s.length > 0),
        ),
      )
    : [];

  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  if (state === "available" && !slot_id_in && !slot_label_in)
    return NextResponse.json({ error: "Missing slot_id or slot_label" }, { status: 400 });

  const prof = await admin
    .from("profiles")
    .select("approved, tier_rank, nearest_venue")
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

  if (!profileMatchesRunServiceRegion(prof.data.nearest_venue, run.data.service_region)) {
    return NextResponse.json({ error: "This run is not available for your region." }, { status: 403 });
  }

  if (isSelectPickupRunType(run.data.run_type)) {
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

  const start_at = run.data.start_at != null ? String(run.data.start_at) : null;

  if (state === "declined") {
    const cleared = await admin
      .from("pickup_run_availability")
      .delete()
      .eq("run_id", run_id)
      .eq("user_id", userId);
    if (cleared.error) {
      return NextResponse.json(
        { error: cleared.error.message || "Could not clear availability." },
        { status: 500 },
      );
    }
    const declinedAt = new Date().toISOString();
    const declined = await admin.from("pickup_run_availability").insert({
      run_id,
      user_id: userId,
      slot_id: null,
      state: "declined",
      updated_at: declinedAt,
    });
    if (declined.error) {
      return NextResponse.json(
        { error: declined.error.message || "Could not record decline." },
        { status: 500 },
      );
    }
  } else {
    // available
    let resolvedSlotId: string | null = null;
    if (slot_id_in) {
      resolvedSlotId = slot_id_in;
    } else if (slot_label_in) {
      try {
        resolvedSlotId = await resolveSlotIdFromLabel(admin, run_id, start_at, slot_label_in);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not resolve slot.";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    if (!resolvedSlotId) {
      return NextResponse.json({ error: "Could not resolve slot." }, { status: 400 });
    }

    const targetLabels =
      slot_labels_selection.length > 0
        ? slot_labels_selection
        : slot_label_in
          ? [slot_label_in]
          : [];

    const targetSlotIds: string[] = [];
    if (targetLabels.length > 0) {
      for (const lbl of targetLabels) {
        try {
          targetSlotIds.push(await resolveSlotIdFromLabel(admin, run_id, start_at, lbl));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not resolve slot.";
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }
    } else {
      targetSlotIds.push(resolvedSlotId);
    }

    const targetIdSet = new Set([...targetSlotIds, resolvedSlotId]);

    const existingAvail = await admin
      .from("pickup_run_availability")
      .select("slot_id")
      .eq("run_id", run_id)
      .eq("user_id", userId)
      .eq("state", "available");

    if (existingAvail.error) {
      return NextResponse.json(
        { error: existingAvail.error.message || "Could not read availability." },
        { status: 500 },
      );
    }

    for (const row of existingAvail.data || []) {
      const sid = row.slot_id ? String(row.slot_id) : null;
      if (sid && !targetIdSet.has(sid)) {
        const d = await admin
          .from("pickup_run_availability")
          .delete()
          .eq("run_id", run_id)
          .eq("user_id", userId)
          .eq("slot_id", sid);
        if (d.error) {
          return NextResponse.json(
            { error: d.error.message || "Could not update availability." },
            { status: 500 },
          );
        }
      }
    }

    const slotIdsToUpsert = Array.from(new Set([...targetSlotIds, resolvedSlotId])).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (slotIdsToUpsert.length === 0) {
      return NextResponse.json({ error: "Could not resolve slot." }, { status: 400 });
    }

    const updatedAt = new Date().toISOString();
    const upsertRows = slotIdsToUpsert.map((slot_id) => ({
      run_id,
      user_id: userId,
      slot_id,
      state: "available" as const,
      updated_at: updatedAt,
    }));

    // #region agent log
    fetch("http://127.0.0.1:7868/ingest/78e6354c-1d0e-4ef4-8b99-968b7592c0e3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ffd01e" },
      body: JSON.stringify({
        sessionId: "ffd01e",
        runId: "pre-fix",
        hypothesisId: "B",
        location: "commit/route.ts:beforeUpsert",
        message: "availability upsert payload",
        data: {
          run_id,
          userId,
          slotIdsToUpsert,
          upsertRowCount: upsertRows.length,
          slot_label_in,
          slot_labels_selection,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    const ins = await admin
      .from("pickup_run_availability")
      .upsert(upsertRows, { onConflict: "run_id,user_id,slot_id" });
  // #region agent log
  fetch("http://127.0.0.1:7868/ingest/78e6354c-1d0e-4ef4-8b99-968b7592c0e3", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ffd01e" },
    body: JSON.stringify({
      sessionId: "ffd01e",
      runId: "pre-fix",
      hypothesisId: "B",
      location: "commit/route.ts:afterUpsert",
      message: "availability upsert result",
      data: {
        ok: !ins.error,
        error: ins.error?.message ?? null,
        code: ins.error?.code ?? null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
    if (ins.error) {
      return NextResponse.json({ error: ins.error.message || "Could not save availability." }, { status: 500 });
    }
  }

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
    : { data: [] as { id: string; tier_rank: number | null }[] };

  const rankMap: Record<string, number> = {};
  for (const p of profs.data || []) rankMap[p.id] = p.tier_rank ?? 6;

  const counts: Record<string, number> = {};
  for (const a of av) {
    const r = rankMap[a.user_id] ?? 6;
    if (!isTier1(r)) continue;
    counts[a.slot_id as string] = (counts[a.slot_id as string] || 0) + 1;
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

    const invitedIds = await invitedUserIdsForPickupPush(admin, run_id, run.data);
    if (invitedIds.length) {
      await sendPushToUsers(admin, invitedIds, {
        title: "Pickup likely on",
        body: "Enough players are available. Admin will finalize the time soon.",
        data: { kind: "pickup_likely_on", run_id },
      });
    }
  }

  // Notify admin of availability submission
  const playerProf = await admin
    .from("profiles")
    .select("full_name, username")
    .eq("id", userId)
    .maybeSingle();
  const playerName =
    playerProf.data?.full_name || playerProf.data?.username || "A player";
  const runTitle = run.data?.title || "a run";
  const adminProfRes = await admin.from("profiles").select("id").eq("is_admin", true);
  const adminIds = (adminProfRes.data || [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => typeof id === "string" && id.length > 0);
  if (adminIds.length) {
    await sendPushToUsers(admin, adminIds, {
      title: "New availability submitted",
      body: `${playerName} submitted availability for ${runTitle}.`,
      data: { kind: "admin_availability", run_id },
    });
  }

  return NextResponse.json({ ok: true });
}
