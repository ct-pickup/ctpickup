import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { enqueueRevalidateAndRun } from "@/lib/admin/sync/enqueueRevalidate";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);
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
    .select("id,title,slug,is_active,service_region,target_teams,official_threshold,max_teams,created_at")
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

  const { data: activeT, error: activeErr } = await admin.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle();

  if (activeErr) {
    return NextResponse.json({ ok: true, tournaments, active_tournament: null, captains: [], submissions: [], panel_error: activeErr.message });
  }

  const active = activeT as { id: string } | null;

  let captains: Record<string, unknown>[] = [];
  if (active?.id) {
    const cRes = await admin
      .from("tournament_captains")
      .select("id,status,captain_name,team_name,claim_submitted_at")
      .eq("tournament_id", active.id)
      .order("claim_submitted_at", { ascending: false });
    if (cRes.error) {
      return NextResponse.json({ ok: true, tournaments, active_tournament: active, captains: [], submissions: [], panel_error: cRes.error.message });
    }
    captains = (cRes.data || []) as Record<string, unknown>[];
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
      panel_error: subErr.message,
    });
  }

  return NextResponse.json({
    ok: true,
    tournaments,
    active_tournament: active,
    captains,
    submissions: submissions ?? [],
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
    if (!Number.isFinite(maxTeams) || maxTeams < 1) {
      return NextResponse.json({ error: "Max teams must be at least 1." }, { status: 400 });
    }
    if (officialThreshold > maxTeams) {
      return NextResponse.json({ error: "Official threshold cannot exceed max teams." }, { status: 400 });
    }
    if (targetTeams > maxTeams) {
      return NextResponse.json({ error: "Target teams cannot exceed max teams." }, { status: 400 });
    }

    const insertRow: Record<string, unknown> = {
      title,
      slug,
      target_teams: targetTeams,
      official_threshold: officialThreshold,
      max_teams: maxTeams,
      is_active: false,
    };
    if (service_region) insertRow.service_region = service_region;

    const { data: created, error } = await admin.from("tournaments").insert(insertRow).select("id,title,slug,is_active,service_region").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    revalidatePath("/admin/tournament");
    await enqueueRevalidateAndRun(admin, ["/tournament", "/status/tournament"]);

    return NextResponse.json({ ok: true, tournament: created });
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
