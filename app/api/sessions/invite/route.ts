import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

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

  // Get run and host info
  const { data: run } = await admin
    .from("pickup_runs")
    .select("id, title, start_at, created_by, run_type, status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (run.created_by !== user.id) return NextResponse.json({ error: "Only the host can invite players" }, { status: 403 });

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

  // pickup_run_invites columns: run_id, user_id, wave, invited_tier_rank, invited_at
  // (no invited_by column — host is implied via pickup_runs.created_by)
  const { data: existingInvite } = await admin
    .from("pickup_run_invites")
    .select("user_id")
    .eq("run_id", run_id)
    .eq("user_id", invitee_id)
    .maybeSingle();

  if (!existingInvite) {
    const now = new Date().toISOString();
    const { error: insErr } = await admin.from("pickup_run_invites").insert({
      run_id,
      user_id: invitee_id,
      wave: 1,
      invited_tier_rank: Number(invitee.tier_rank ?? 6),
      invited_at: now,
    });
    if (insErr && !/duplicate|unique/i.test(insErr.message || "")) {
      console.error("[sessions/invite] pickup_run_invites insert:", insErr.message);
      return NextResponse.json({ error: "Could not save invite." }, { status: 500 });
    }
  }

  const { data: host } = await admin
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", user.id)
    .maybeSingle();

  const hostName = [host?.first_name, host?.last_name].filter(Boolean).join(" ") || host?.username || "Someone";
  const sessionDate = new Date(run.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Send push to invitee
  await sendPushToUsers(admin, [invitee_id], {
    title: "Session invite 🎯",
    body: `${hostName} invited you to their session on ${sessionDate}`,
    data: { screen: `session/${run_id}`, run_id, url: `ctpickup://session/${run_id}` },
  });

  return NextResponse.json({ ok: true, already_invited: !!existingInvite });
}
