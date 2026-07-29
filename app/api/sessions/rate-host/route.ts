import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function score1to5(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * Rate a session host after attending a completed pickup run.
 * Body: { run_id, field_secured, organization, player_quality, safety, would_play_again }
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const run_id = String(body.run_id ?? "").trim();
  const field_secured = score1to5(body.field_secured);
  const organization = score1to5(body.organization);
  const player_quality = score1to5(body.player_quality);
  const safety = score1to5(body.safety);
  const would_play_again = score1to5(body.would_play_again);

  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  if (
    field_secured == null ||
    organization == null ||
    player_quality == null ||
    safety == null ||
    would_play_again == null
  ) {
    return NextResponse.json(
      { error: "All ratings must be integers from 1 to 5." },
      { status: 400 },
    );
  }

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id,created_by,status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const host_id = typeof run.created_by === "string" ? run.created_by : null;
  if (!host_id) {
    return NextResponse.json({ error: "Run has no host." }, { status: 400 });
  }

  if (host_id === user.id) {
    return NextResponse.json({ error: "Hosts cannot rate themselves." }, { status: 403 });
  }

  if (run.status !== "completed") {
    return NextResponse.json({ error: "Session must be completed before rating the host." }, { status: 403 });
  }

  const { data: rsvp } = await admin
    .from("pickup_run_rsvps")
    .select("status")
    .eq("run_id", run_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (rsvp?.status !== "confirmed") {
    return NextResponse.json({ error: "Only confirmed attendees can rate the host." }, { status: 403 });
  }

  const { data: existing } = await admin
    .from("host_ratings")
    .select("id,overall")
    .eq("run_id", run_id)
    .eq("rater_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      overall: existing.overall != null ? Number(existing.overall) : null,
      already_rated: true,
    });
  }

  const { data: inserted, error: insErr } = await admin
    .from("host_ratings")
    .insert({
      run_id,
      rater_id: user.id,
      host_id,
      field_secured,
      organization,
      player_quality,
      safety,
      would_play_again,
    })
    .select("overall")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again } = await admin
        .from("host_ratings")
        .select("overall")
        .eq("run_id", run_id)
        .eq("rater_id", user.id)
        .maybeSingle();
      return NextResponse.json({
        ok: true,
        overall: again?.overall != null ? Number(again.overall) : null,
        already_rated: true,
      });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    overall: inserted?.overall != null ? Number(inserted.overall) : null,
  });
}
