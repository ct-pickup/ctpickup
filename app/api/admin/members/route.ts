import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", u.data.user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await admin
    .from("profiles")
    .select("id,first_name,last_name,username,instagram,tier,tier_rank,approved,created_at,playing_position,zip_code,is_banned,ban_reason,wins_override,losses_override,player_of_day_override,defender_of_day_override,midfielder_of_day_override,attacker_of_day_override")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ members: data || [] });
}

export async function PATCH(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", u.data.user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { user_id, tier_rank, tier, approved, is_banned, ban_reason, wins_override, losses_override, player_of_day_override, defender_of_day_override, midfielder_of_day_override, attacker_of_day_override } = body;
  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (tier_rank !== undefined) update.tier_rank = tier_rank;
  if (tier !== undefined) update.tier = tier;
  if (approved !== undefined) update.approved = approved;
  if (is_banned !== undefined) update.is_banned = is_banned;
  if (ban_reason !== undefined) update.ban_reason = ban_reason;
  if (wins_override !== undefined) update.wins_override = wins_override;
  if (losses_override !== undefined) update.losses_override = losses_override;
  if (player_of_day_override !== undefined) update.player_of_day_override = player_of_day_override;
  if (defender_of_day_override !== undefined) update.defender_of_day_override = defender_of_day_override;
  if (midfielder_of_day_override !== undefined) update.midfielder_of_day_override = midfielder_of_day_override;
  if (attacker_of_day_override !== undefined) update.attacker_of_day_override = attacker_of_day_override;

  const { error } = await admin.from("profiles").update(update).eq("id", user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", u.data.user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { user_id } = body;
  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
