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
    .select("id,first_name,last_name,username,instagram,tier,tier_rank,approved,created_at,playing_position,zip_code")
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
  const { user_id, tier_rank, tier, approved } = body;
  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (tier_rank !== undefined) update.tier_rank = tier_rank;
  if (tier !== undefined) update.tier = tier;
  if (approved !== undefined) update.approved = approved;

  const { error } = await admin.from("profiles").update(update).eq("id", user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
