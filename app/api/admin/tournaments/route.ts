import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { enqueueRevalidateAndRun } from "@/lib/admin/sync/enqueueRevalidate";
import { approvedUserIdsWithinTournamentDrive } from "@/lib/tournament/tournamentDriveProximity";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { recordTournamentActivationChange } from "@/lib/admin/surfaceHealth";
import { setOutdoorTournamentHub } from "@/lib/tournament/setOutdoorTournamentHub";
import { refundPaidCaptainsOnTournamentCancel } from "@/lib/tournament/refundPaidCaptainsOnTournamentCancel";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";
import { normalizeUsZipDigits } from "@/lib/zipRegion";

export const runtime = "nodejs";

const DECISIONS = new Set(["pending", "confirmed", "standby", "rejected"]);

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const url = new URL(req.url);
  const regionRaw = String(url.searchParams.get("region") || "").trim().toUpperCase();
  const region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;
  const includePanel = url.searchParams.get("include") === "panel" || url.searchParams.get("panel") === "1";
  const decisionFilter = String(url.searchParams.get("decision") || "").trim().toLowerCase();

  let tQuery = admin
    .from("tournaments")
    .select(
      "id,title,slug,is_active,service_region,target_teams,official_threshold,max_teams,created_at,start_at,venue,canceled_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (region) {
    tQuery = tQuery.eq("service_region", region);
  }

  const { data, error } = await tQuery;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tournaments = data ?? [];

  if (!includePanel) {
    return NextResponse.json({ ok: true, tournaments });
  }

  let activeQuery = admin.from("tournaments").select("*").eq("is_active", true);
  if (region) {
    activeQuery = activeQuery.eq("service_region", region);
  } else {
    activeQuery = activeQuery.is("service_region", null);
  }
  let { data: activeT, error: activeErr } = await activeQuery.maybeSingle();

  if (!activeErr && !activeT && region) {
    const fallback = await admin.from("tournaments").select("*").eq("is_active", true).is("service_region", null).maybeSingle();
    activeT = fallback.data;
    activeErr = fallback.error;
  }
  if (!activeErr && !activeT && !region) {
    const any = await admin.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle();
    activeT = any.data;
    activeErr = any.error;
  }

  if (activeErr) {
    return NextResponse.json({ ok: true, tournaments, active_tournament: null, captains: [], submissions: [], panel_error: activeErr.message });
  }

  const active = activeT as { id: string } | null;

  let captains: Record<string, unknown>[] = [];
  if (active?.id) {
    const cRes = await admin
      .from("tournament_captains")
      .select(
        "id,status,captain_name,team_name,captain_instagram,claim_submitted_at,captain_verified,user_id,expected_players,players_paid,payment_received_at",
      )
      .eq("tournament_id", active.id)
      .order("claim_submitted_at", { ascending: false });
    if (cRes.error) {
      return NextResponse.json({ ok: true, tournaments, active_tournament: active, captains: [], submissions: [], panel_error: cRes.error.message });
    }
    const raw = (cRes.data || []) as Record<string, unknown>[];
    const capIds = raw.map((r) => String(r.id));
    let rosterByCaptain: Record<string, number> = {};
    if (capIds.length) {
      const rRes = await admin.from("tournament_roster").select("captain_id,status").in("captain_id", capIds);
      if (!rRes.error && rRes.data) {
        for (const row of rRes.data as { captain_id: string; status: string }[]) {
          if (row.status === "invited" || row.status === "accepted") {
            rosterByCaptain[row.captain_id] = (rosterByCaptain[row.captain_id] || 0) + 1;
          }
        }
      }
    }
    captains = raw.map((c) => ({
      ...c,
      roster_size: rosterByCaptain[String(c.id)] ?? 0,
    }));
  }

  let prize_pool_cents: number | null = null;
  if (active?.id) {
    const ppRes = await admin
      .from("tournament_payments")
      .select("amount_cents")
      .eq("tournament_id", active.id)
      .eq("status", "captured");
    if (!ppRes.error && ppRes.data) {
      prize_pool_cents = (ppRes.data as { amount_cents: number }[]).reduce(
        (sum, r) => sum + (r.amount_cents ?? 0),
        0,
      );
    }
  }

  let subQuery = admin
    .from("tourney_submissions")
    .select("id,created_at,first_name,last_name,instagram,decision,notes,reviewed,meta")
    .order("created_at", { ascending: false })
    .limit(200);

  if (decisionFilter && DECISIONS.has(decisionFilter)) {
    subQuery = subQuery.eq("decision", decisionFilter);
  }

  const { data: submissions, error: subErr } = await subQuery;
  if (subErr) {
    return NextResponse.json({
      ok: true,
      tournaments,
      active_tournament: active,
      captains,
      submissions: [],
      prize_pool_cents,
      panel_error: subErr.message,
    });
  }

  return NextResponse.json({
    ok: true,
    tournaments,
    active_tournament: active,
    captains,
    submissions: submissions ?? [],
    prize_pool_cents,
  });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").trim();

  if (action === "create") {
    const title = String(body.title || "").trim();
    let slug = String(body.slug || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const targetTeams = Number(body.target_teams);
    const officialThreshold = Number(body.official_threshold);
    const maxTeams = Number(body.max_teams);
    const regionRaw = body.service_region != null ? String(body.service_region).trim().toUpperCase() : "";
    const service_region = regionRaw && HUB_REGIONS.has(regionRaw) ? regionRaw : null;
    const start_at = body.start_at != null ? String(body.start_at).trim() : "";
    const registration_deadline =
      body.registration_deadline != null ? String(body.registration_deadline).trim() : "";

    if (!title || title.length < 2) {
      return NextResponse.json({ error: "Title is required (min 2 characters)." }, { status: 400 });
    }
    if (!slug || slug.length < 2) {
      slug = slugifyTitle(title);
    }
    if (!slug) {
      return NextResponse.json({ error: "Slug is required (derive from title or provide URL name)." }, { status: 400 });
    }
    if (!Number.isFinite(targetTeams) || targetTeams < 1) {
      return NextResponse.json({ error: "Target teams must be at least 1." }, { status: 400 });
    }
    if (!Number.isFinite(officialThreshold) || officialThreshold < 1) {
      return NextResponse.json({ error: "Official threshold must be at least 1." }, { status: 400 });
    }
    if (!Number.isFinite(maxTeams) || maxTeams < 8 || maxTeams > 12) {
      return NextResponse.json({ error: "Max teams must be between 8 and 12." }, { status: 400 });
    }
    if (officialThreshold > maxTeams) {
      return NextResponse.json({ error: "Official threshold cannot exceed max teams." }, { status: 400 });
    }
    if (targetTeams > maxTeams) {
      return NextResponse.json({ error: "Target teams cannot exceed max teams." }, { status: 400 });
    }

    const venue = body.venue != null ? String(body.venue).trim() : "";
    const venue_zip_code = normalizeUsZipDigits(
      body.venue_zip_code != null ? String(body.venue_zip_code) : null,
    );
    const format_summary = body.format_summary != null ? String(body.format_summary).trim() : "";
    const entryFeeCents = Number(body.entry_fee_cents);
    const minRoster = Number(body.min_roster_players);

    const insertRow: Record<string, unknown> = {
      title,
      slug,
      target_teams: targetTeams,
      official_threshold: officialThreshold,
      max_teams: maxTeams,
      is_active: false,
    };
    if (service_region) insertRow.service_region = service_region;
    if (start_at) insertRow.start_at = start_at;
    if (registration_deadline) insertRow.registration_deadline = registration_deadline;
    if (venue) insertRow.venue = venue;
    if (venue_zip_code) insertRow.venue_zip_code = venue_zip_code;
    if (format_summary) insertRow.format_summary = format_summary;
    if (Number.isFinite(entryFeeCents) && entryFeeCents > 0) insertRow.entry_fee_cents = Math.floor(entryFeeCents);
    if (Number.isFinite(minRoster) && minRoster >= 1) insertRow.min_roster_players = Math.floor(minRoster);

    const { data: created, error } = await admin.from("tournaments").insert(insertRow).select("id,title,slug,is_active,service_region").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    revalidatePath("/admin/tournament");
    await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);

    return NextResponse.json({ ok: true, tournament: created });
  }

  if (action === "set_hub") {
    const tournament_id =
      body.tournament_id === null || body.tournament_id === "" ? null : String(body.tournament_id);

    const hub = await setOutdoorTournamentHub(admin, tournament_id);
    if (!hub.ok) {
      const st = hub.error === "Tournament not found." ? 404 : 500;
      return NextResponse.json({ error: hub.error }, { status: st });
    }

    if (tournament_id) {
      const tourRes = await admin
        .from("tournaments")
        .select("venue,service_region,venue_zip_code")
        .eq("id", tournament_id)
        .maybeSingle();
      if (tourRes.error) return NextResponse.json({ error: tourRes.error.message }, { status: 500 });

      const userIds = await approvedUserIdsWithinTournamentDrive(admin, {
        venue: tourRes.data?.venue ?? null,
        serviceRegion: tourRes.data?.service_region ?? null,
        venueZipCode: tourRes.data?.venue_zip_code ?? null,
      });
      if (userIds.length) {
        await sendPushToUsers(admin, userIds, {
          title: "Tournament is live",
          body: "A new captain tournament is open. Claim your team spot now.",
          data: { kind: "tournament_live", tournament_id },
        });
      }
    }

    await recordTournamentActivationChange(admin, guard.userId);
    await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);

    revalidatePath("/tournament");
    revalidatePath("/admin/tournament");
    revalidatePath("/admin/relationships");
    revalidatePath("/admin");

    return NextResponse.json({ ok: true });
  }

  if (action === "update_submission") {
    const id = String(body.submission_id || "").trim();
    const decision = String(body.decision || "pending").trim().toLowerCase();
    const notes = body.notes != null ? String(body.notes).trim() : "";
    const reviewed = !!body.reviewed;

    if (!id) return NextResponse.json({ error: "Missing submission_id." }, { status: 400 });
    if (!DECISIONS.has(decision)) {
      return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
    }

    const { error } = await admin
      .from("tourney_submissions")
      .update({
        decision,
        reviewed,
        notes: notes || null,
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    revalidatePath("/admin/tournament");
    return NextResponse.json({ ok: true });
  }

  if (action === "approve_captain_claim") {
    const captain_id = String(body.captain_id || "").trim();
    if (!captain_id) return NextResponse.json({ error: "Missing captain_id." }, { status: 400 });
    const { error } = await admin.from("tournament_captains").update({ captain_verified: true }).eq("id", captain_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reject_captain_claim") {
    const captain_id = String(body.captain_id || "").trim();
    if (!captain_id) return NextResponse.json({ error: "Missing captain_id." }, { status: 400 });
    const { error } = await admin
      .from("tournament_captains")
      .update({ captain_verified: false, status: "claim_rejected" })
      .eq("id", captain_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel_tournament") {
    const tournament_id = String(body.tournament_id || "").trim();
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id." }, { status: 400 });

    const { data: caps } = await admin
      .from("tournament_captains")
      .select("user_id,status")
      .eq("tournament_id", tournament_id)
      .in("status", ["payment_received", "roster_pending", "verification_in_progress", "flagged_for_review", "confirmed"]);

    const refundResult = await refundPaidCaptainsOnTournamentCancel(admin, tournament_id);

    await admin
      .from("tournaments")
      .update({ is_active: false, canceled_at: new Date().toISOString() })
      .eq("id", tournament_id);

    const notifyIds = [...new Set((caps || []).map((c: { user_id: string }) => c.user_id).filter(Boolean))];
    if (notifyIds.length) {
      await sendPushToUsers(admin, notifyIds, {
        title: "Tournament canceled",
        body: "The tournament was canceled by staff. If you paid a captain entry fee, a refund has been started when possible.",
        data: { kind: "tournament_canceled", tournament_id },
      });
    }

    await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);
    revalidatePath("/admin/tournament");
    revalidatePath("/tournament");

    return NextResponse.json({ ok: true, refund: refundResult });
  }

  if (action === "set_early_termination") {
    const tournament_id = String(body.tournament_id || "").trim();
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id." }, { status: 400 });
    const early_termination = !!body.early_termination;
    const { error } = await admin
      .from("tournaments")
      .update({ early_termination })
      .eq("id", tournament_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "mark_prizes_paid") {
    const tournament_id = String(body.tournament_id || "").trim();
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id." }, { status: 400 });
    const { data: existing, error: fetchErr } = await admin
      .from("tournaments")
      .select("prizes_paid_at")
      .eq("id", tournament_id)
      .maybeSingle();
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (existing?.prizes_paid_at) {
      return NextResponse.json({ error: "Prizes already marked as paid." }, { status: 409 });
    }
    const { error } = await admin
      .from("tournaments")
      .update({ prizes_paid_at: new Date().toISOString(), prizes_paid_by: guard.userId })
      .eq("id", tournament_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: deleted, error } = await admin.from("tournaments").delete().eq("id", id).select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });

  revalidatePath("/admin/tournament");
  await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);
  revalidatePath("/tournament");

  return NextResponse.json({ ok: true });
}
