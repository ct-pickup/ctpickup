import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { profileMatchesRunServiceRegion } from "@/lib/pickup/venueServiceRegion";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const HUB_REGIONS = new Set(["NY", "CT", "NJ", "MD"]);

function displayName(p: {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}): string {
  const n = `${String(p.first_name || "").trim()} ${String(p.last_name || "").trim()}`.trim();
  return n || String(p.username || "").trim() || "Player";
}

/** GET — run summary + approved players (optional filter by run service region). */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  try {
    const admin = getSupabaseAdmin();
    const url = new URL(req.url);
    const run_id = String(url.searchParams.get("run_id") || "").trim();
    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

    const runRes = await admin
      .from("pickup_runs")
      .select("id,title,run_type,status,service_region")
      .eq("id", run_id)
      .maybeSingle();
    const run = runRes.data;
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (isPublicPickupRunType(run.run_type)) {
      return NextResponse.json({ error: "Invite players applies to Select runs only." }, { status: 400 });
    }

    const profRes = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,tier_rank,nearest_venue")
      .eq("approved", true)
      .order("first_name", { ascending: true });

    if (profRes.error) {
      return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    }

    const serviceRegion =
      run.service_region != null && String(run.service_region).trim()
        ? String(run.service_region).trim().toUpperCase()
        : null;
    const regionOk = serviceRegion && HUB_REGIONS.has(serviceRegion) ? serviceRegion : null;

    const rows = (profRes.data || []).filter((p) => {
      if (!regionOk) return true;
      return profileMatchesRunServiceRegion(p.nearest_venue, regionOk);
    });

    const players = rows.map((p) => ({
      id: p.id,
      display_name: displayName(p),
      username: p.username ?? null,
      tier_rank: p.tier_rank ?? null,
    }));

    return NextResponse.json({
      run: {
        id: run.id,
        title: run.title,
        run_type: run.run_type,
        status: run.status,
        service_region: run.service_region ?? null,
      },
      players,
    });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[admin/pickup/invite-players GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST — insert pickup_run_invites and notify newly invited players. */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  try {
    const admin = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const run_id = String(body.run_id || "").trim();
    const rawIds = body.user_ids;
    const user_ids = Array.isArray(rawIds)
      ? Array.from(
          new Set(
            rawIds
              .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
              .filter((s: string) => s.length > 0),
          ),
        )
      : [];

    if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    if (!user_ids.length) return NextResponse.json({ error: "No user_ids provided" }, { status: 400 });

    const runRes = await admin.from("pickup_runs").select("id,title,run_type,status,outreach_started_at").eq("id", run_id).maybeSingle();
    const run = runRes.data;
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (isPublicPickupRunType(run.run_type)) {
      return NextResponse.json({ error: "Invite players applies to Select runs only." }, { status: 400 });
    }

    const st = String(run.status || "").trim().toLowerCase();
    if (st === "canceled" || st === "cancelled" || st === "completed" || st === "in_progress") {
      return NextResponse.json({ error: "Cannot invite on this run status." }, { status: 400 });
    }

    const profRes = await admin
      .from("profiles")
      .select("id,tier_rank")
      .eq("approved", true)
      .in("id", user_ids);

    if (profRes.error) return NextResponse.json({ error: profRes.error.message }, { status: 500 });

    const approvedSet = new Map((profRes.data || []).map((p) => [p.id as string, Number(p.tier_rank ?? 6)]));
    const invalid = user_ids.filter((id) => !approvedSet.has(id));
    if (invalid.length) {
      return NextResponse.json({ error: `Some users are not approved accounts: ${invalid.slice(0, 5).join(", ")}` }, { status: 400 });
    }

    const existingRes = await admin.from("pickup_run_invites").select("user_id").eq("run_id", run_id);
    if (existingRes.error) return NextResponse.json({ error: existingRes.error.message }, { status: 500 });

    const already = new Set((existingRes.data || []).map((r: { user_id: string }) => r.user_id));
    const toAdd = user_ids.filter((id) => !already.has(id));
    if (!toAdd.length) {
      return NextResponse.json({ ok: true, invited: 0, already_invited: user_ids.length });
    }

    const now = new Date().toISOString();
    const wave = 1;
    const insertRows = toAdd.map((user_id) => ({
      run_id,
      user_id,
      wave,
      invited_tier_rank: approvedSet.get(user_id) ?? 6,
      invited_at: now,
    }));

    const ins = await admin.from("pickup_run_invites").insert(insertRows);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

    if (!run.outreach_started_at) {
      await admin
        .from("pickup_runs")
        .update({ outreach_started_at: now, auto_managed: true, updated_at: now })
        .eq("id", run_id);
    }

    const title = typeof run.title === "string" && run.title.trim() ? run.title.trim() : "a pickup run";
    await sendPushToUsers(admin, toAdd, {
      title: "Select pickup invite",
      body: `You're invited to ${title}. Open the app to confirm or decline.`,
      data: { kind: "pickup_invite", run_id },
    });

    return NextResponse.json({ ok: true, invited: toAdd.length, already_invited: user_ids.length - toAdd.length });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[admin/pickup/invite-players POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
