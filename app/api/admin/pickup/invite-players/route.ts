import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { createDriveMinutesCache, filterProfilesByMaxDriveTime } from "@/lib/pickup/profileMaxDriveFilter";
import { buildProximityInvitePlayerList, resolveDriveTimeDestination } from "@/lib/venueDistance";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/** GET — run summary + approved players with drive-time from ZIP to the run venue. */
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
      .select("id,title,run_type,status,service_region,location_private,venue_zip_code")
      .eq("id", run_id)
      .maybeSingle();
    const run = runRes.data;
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (isPublicPickupRunType(run.run_type)) {
      return NextResponse.json({ error: "Invite players applies to Select runs only." }, { status: 400 });
    }

    const dest = resolveDriveTimeDestination({
      venueZipCode: run.venue_zip_code,
      locationPrivate: run.location_private,
      serviceRegion: run.service_region,
    });
    if (!dest) {
      return NextResponse.json(
        { error: "Set a venue on this run (location or service region) before inviting players." },
        { status: 400 },
      );
    }

    const profRes = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,instagram,tier_rank,zip_code,nearest_venue,max_drive_minutes")
      .eq("approved", true)
      .order("first_name", { ascending: true });

    if (profRes.error) {
      return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    }

    const driveCache = createDriveMinutesCache();
    const eligible = await filterProfilesByMaxDriveTime(
      profRes.data || [],
      {
        venueZipCode: run.venue_zip_code,
        locationPrivate: run.location_private,
        serviceRegion: run.service_region,
      },
      driveCache,
    );
    const players = await buildProximityInvitePlayerList(eligible, dest, driveCache);

    return NextResponse.json({
      run: {
        id: run.id,
        title: run.title,
        run_type: run.run_type,
        status: run.status,
        service_region: run.service_region ?? null,
        venue: dest.venue,
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

    const runRes = await admin
      .from("pickup_runs")
      .select("id,title,run_type,status,outreach_started_at,service_region")
      .eq("id", run_id)
      .maybeSingle();
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

    const previousInviteeIds = Array.from(already).filter((id) => !toAdd.includes(id));
    if (previousInviteeIds.length > 0) {
      const availRes = await admin.from("pickup_run_availability").select("user_id").eq("run_id", run_id);
      if (availRes.error) return NextResponse.json({ error: availRes.error.message }, { status: 500 });

      const responded = new Set((availRes.data || []).map((r: { user_id: string }) => String(r.user_id)));
      const toRemind = previousInviteeIds.filter((id) => !responded.has(id));
      if (toRemind.length > 0) {
        await sendPushToUsers(admin, toRemind, {
          title: "Last call — CT Pickup reminder",
          body: "More players have been invited to your run. Confirm your spot before it fills up.",
          data: { kind: "pickup_invite", run_id },
        });
      }
    }

    const promotedRegion =
      run.service_region === null || run.service_region === undefined
        ? null
        : String(run.service_region).trim().toUpperCase();

    if (promotedRegion !== null) {
      const clear = await admin
        .from("pickup_runs")
        .update({ is_current: false, updated_at: now })
        .eq("is_current", true)
        .eq("service_region", promotedRegion);
      if (clear.error) return NextResponse.json({ error: clear.error.message }, { status: 500 });
    } else {
      const clear = await admin
        .from("pickup_runs")
        .update({ is_current: false, updated_at: now })
        .eq("is_current", true)
        .is("service_region", null);
      if (clear.error) return NextResponse.json({ error: clear.error.message }, { status: 500 });
    }

    const promote = await admin
      .from("pickup_runs")
      .update({ is_current: true, updated_at: now })
      .eq("id", run_id);
    if (promote.error) return NextResponse.json({ error: promote.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, invited: toAdd.length, already_invited: user_ids.length - toAdd.length });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[admin/pickup/invite-players POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
