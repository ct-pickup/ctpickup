import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { autoSettleTierSession } from "@/lib/pickup/autoSettleSession";
import { resolvePotdFromVotes } from "@/lib/pickup/resolvePotdFromVotes";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

function asUuid(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const supabase = supabaseService();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const run_id = asUuid(b.run_id);
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const now = new Date().toISOString();

  const { data: run, error: runErr } = await supabase
    .from("pickup_runs")
    .select("id,title,location_text,start_at,created_by,open_tier_rank,tier_session_id")
    .eq("id", run_id)
    .maybeSingle();

  if (runErr || !run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { error: updateErr } = await supabase
    .from("pickup_runs")
    .update({ status: "completed", updated_at: now })
    .eq("id", run_id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  let tier_session_id = asUuid(run.tier_session_id);
  if (!tier_session_id) {
    const TIER_RANK_TO_NAME: Record<number, string> = {
      0: "bronze",
      1: "bronze",
      2: "silver",
      3: "gold",
      4: "platinum",
      5: "diamond",
    };
    const min_tier = TIER_RANK_TO_NAME[Number(run.open_tier_rank ?? 0)] ?? "bronze";

    const { data: ts, error: tsErr } = await supabase
      .from("tier_sessions")
      .insert({
        organizer_id: run.created_by ?? guard.userId,
        venue: run.location_text ?? run.title ?? "CT Pickup Session",
        starts_at: run.start_at ?? now,
        capacity: 20,
        min_tier,
        state: "open",
        created_at: now,
      })
      .select("id")
      .maybeSingle();

    if (tsErr || !ts) {
      console.error("[end-run] tier_session insert error", tsErr);
    } else {
      tier_session_id = ts.id;
      await supabase.from("pickup_runs").update({ tier_session_id }).eq("id", run_id);
    }
  }

  if (tier_session_id) {
    const { data: rsvps } = await supabase
      .from("pickup_run_rsvps")
      .select("user_id")
      .eq("run_id", run_id)
      .in("status", ["confirmed", "pending_payment"]);

    if (rsvps && rsvps.length > 0) {
      const attendanceRows = rsvps.map((r: { user_id: string }) => ({
        session_id: tier_session_id,
        user_id: r.user_id,
        status: "attended",
      }));

      await supabase
        .from("session_attendance")
        .upsert(attendanceRows, { onConflict: "session_id,user_id" });

      for (const r of rsvps) {
        await supabase
          .from("player_ratings")
          .upsert({ user_id: r.user_id }, { onConflict: "user_id", ignoreDuplicates: true });
      }
    }

    const settle = await autoSettleTierSession(supabase, tier_session_id);

    // If results already exist, refresh player_of_day from attendee POTD votes.
    const { data: existingResult } = await supabase
      .from("pickup_run_results")
      .select("player_of_day")
      .eq("run_id", run_id)
      .maybeSingle();

    let potd: Awaited<ReturnType<typeof resolvePotdFromVotes>> | null = null;
    if (existingResult) {
      const hostPick =
        typeof existingResult.player_of_day === "string" ? existingResult.player_of_day : null;
      potd = await resolvePotdFromVotes(supabase, run_id, hostPick);
      if (potd.winnerId && potd.winnerId !== hostPick) {
        await supabase
          .from("pickup_run_results")
          .update({ player_of_day: potd.winnerId })
          .eq("run_id", run_id);
      } else if (potd.winnerId && !hostPick) {
        await supabase
          .from("pickup_run_results")
          .update({ player_of_day: potd.winnerId })
          .eq("run_id", run_id);
      }
    }

    return NextResponse.json({
      ok: true,
      run_id,
      tier_session_id,
      settled: settle.settled,
      settle_error: settle.error ?? null,
      potd: potd
        ? {
            winner_id: potd.winnerId,
            vote_count: potd.voteCount,
            total_votes: potd.totalVotes,
            tied: potd.tied,
          }
        : null,
    });
  }

  return NextResponse.json({ ok: true, run_id, tier_session_id });
}
