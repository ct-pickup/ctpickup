import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { deliverRunInvite } from "@/lib/pickup/deliverRunInvite";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id, invitee_id } = await req.json() as { run_id: string; invitee_id: string };
  if (!run_id || !invitee_id) return NextResponse.json({ error: "run_id and invitee_id required" }, { status: 400 });

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, start_at, created_by, run_type, status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (run.created_by !== user.id) {
    const { data: caller } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (caller?.is_admin !== true) {
      return NextResponse.json({ error: "Only the host can invite players" }, { status: 403 });
    }
  }

  const st = String(run.status || "").trim().toLowerCase();
  if (st === "canceled" || st === "cancelled" || st === "completed" || st === "in_progress") {
    return NextResponse.json({ error: "Cannot invite on this session status." }, { status: 400 });
  }

  if (invitee_id === user.id) {
    return NextResponse.json({ error: "You cannot invite yourself." }, { status: 400 });
  }

  const { data: invitee } = await admin
    .from("profiles")
    .select("id, approved, tier_rank, first_name, last_name, username")
    .eq("id", invitee_id)
    .maybeSingle();

  if (!invitee?.id) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  if (!invitee.approved) {
    return NextResponse.json({ error: "That player is not approved yet." }, { status: 400 });
  }

  const delivered = await deliverRunInvite(admin, {
    run: { id: run_id, start_at: run.start_at },
    inviteeId: invitee_id,
    inviteeTierRank: invitee.tier_rank,
    inviterId: user.id,
  });
  if (!delivered.ok) return NextResponse.json({ error: delivered.error }, { status: 500 });

  return NextResponse.json({ ok: true, already_invited: delivered.alreadyLinked });
}
