import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { notifyEsportsBecameActive } from "@/lib/esports/notifyEsportsBecameActive";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const STATUSES = new Set(["upcoming", "active", "completed"]);

const SELECT_LIST =
  "id,title,game,prize,start_date,end_date,status,description,format_summary,created_at,group_stage_deadline_1,group_stage_deadline_2,group_stage_final_deadline,knockout_start_at,quarterfinal_deadline,semifinal_deadline,final_deadline";

function optionalIso(raw: unknown, field: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { ok: true, value: null };
  if (Number.isNaN(Date.parse(s))) return { ok: false, message: `Invalid ISO datetime for ${field}.` };
  return { ok: true, value: s };
}

function requiredIso(label: string, raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { ok: false, message: `${label} is required (ISO 8601).` };
  if (Number.isNaN(Date.parse(s))) return { ok: false, message: `${label} must be a valid ISO 8601 datetime.` };
  return { ok: true, value: s };
}

export async function GET(_req: Request) {
  const guard = await requireAdminBearer(_req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("esports_tournaments").select(SELECT_LIST).order("start_date", { ascending: false }).limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tournaments: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const b = await req.json().catch(() => ({}));
  const title = String(b.title || "").trim();
  const game = String(b.game || "").trim();
  const prize = String(b.prize || "").trim();
  const description = String(b.description ?? "").trim() || null;
  const format_summary = String(b.format_summary ?? "").trim() || null;
  const status = String(b.status || "upcoming").trim().toLowerCase();

  if (!title || title.length < 2) {
    return NextResponse.json({ error: "Title is required (min 2 characters)." }, { status: 400 });
  }
  if (!game) return NextResponse.json({ error: "Game is required." }, { status: 400 });
  if (!prize) return NextResponse.json({ error: "Prize is required." }, { status: 400 });
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be upcoming, active, or completed." }, { status: 400 });
  }

  const startR = requiredIso("start_date", b.start_date);
  if (!startR.ok) return NextResponse.json({ error: startR.message }, { status: 400 });
  const endR = requiredIso("end_date", b.end_date);
  if (!endR.ok) return NextResponse.json({ error: endR.message }, { status: 400 });

  const deadlineKeys = [
    "group_stage_deadline_1",
    "group_stage_deadline_2",
    "group_stage_final_deadline",
    "knockout_start_at",
    "quarterfinal_deadline",
    "semifinal_deadline",
    "final_deadline",
  ] as const;

  const deadlines: Record<string, string | null> = {};
  for (const k of deadlineKeys) {
    const v = optionalIso(b[k], k);
    if (!v.ok) return NextResponse.json({ error: v.message }, { status: 400 });
    deadlines[k] = v.value;
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("esports_tournaments")
    .insert({
      title,
      game,
      prize,
      start_date: startR.value,
      end_date: endR.value,
      status,
      description,
      format_summary,
      ...deadlines,
    })
    .select(SELECT_LIST)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const inserted = data as { id: string; status?: string };
  await notifyEsportsBecameActive(admin, inserted.id, undefined, String(inserted.status || ""));

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");

  return NextResponse.json({ ok: true, tournament: data });
}
