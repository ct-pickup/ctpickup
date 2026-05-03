import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_rooms")
    .select("id,slug,title,is_active,announcements_only,closes_at,created_at,created_by")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rooms: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").trim();
  const title = String(body.title || "").trim();

  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(slug)) {
    return NextResponse.json(
      { error: "slug must be 2-63 chars: letters, numbers, _ or -" },
      { status: 400 },
    );
  }

  const is_active = body.is_active === false ? false : true;
  const announcements_only = body.announcements_only === true ? true : false;
  const closes_at_raw = body.closes_at == null || body.closes_at === "" ? null : String(body.closes_at);
  const closes_at = closes_at_raw ? new Date(closes_at_raw).toISOString() : null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_rooms")
    .insert({
      slug,
      title,
      is_active,
      announcements_only,
      closes_at,
      created_by: guard.userId,
    })
    .select("id,slug,title,is_active,announcements_only,closes_at,created_at,created_by")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, room: data });
}

