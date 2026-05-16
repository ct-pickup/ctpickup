import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

function displayName(p: ProfileRow | undefined, fallbackId: string): string {
  if (!p) return fallbackId;
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ");
  return n || p.username || fallbackId;
}

export async function GET(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const admin = supabaseService();
  const { data: rows, error } = await admin
    .from("chat_reports")
    .select("id, reason, created_at, reporter_user_id, reported_user_id, message_id, room_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = (rows || []) as {
    id: string;
    reason: string;
    created_at: string;
    reporter_user_id: string;
    reported_user_id: string;
    message_id: string | null;
    room_id: string | null;
  }[];

  const ids = new Set<string>();
  for (const r of list) {
    ids.add(r.reporter_user_id);
    ids.add(r.reported_user_id);
  }
  const idArr = [...ids];
  let profileById = new Map<string, ProfileRow>();
  if (idArr.length > 0) {
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select("id, first_name, last_name, username")
      .in("id", idArr);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    profileById = new Map((profs || []).map((p: ProfileRow) => [p.id, p]));
  }

  const reports = list.map((r) => {
    const type: "profile" | "message" = r.message_id == null ? "profile" : "message";
    return {
      id: r.id,
      reason: r.reason,
      created_at: r.created_at,
      reporter_name: displayName(profileById.get(r.reporter_user_id), r.reporter_user_id),
      reported_name: displayName(profileById.get(r.reported_user_id), r.reported_user_id),
      reported_user_id: r.reported_user_id,
      message_id: r.message_id,
      room_id: r.room_id,
      type,
    };
  });

  return NextResponse.json({ reports });
}

export async function DELETE(req: Request) {
  const gate = await requireAdminBearer(req);
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseService();
  const { error } = await admin.from("chat_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
