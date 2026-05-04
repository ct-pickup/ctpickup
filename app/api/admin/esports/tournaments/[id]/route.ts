import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const STATUSES = new Set(["upcoming", "active", "completed"]);

const SELECT_LIST =
  "id,title,game,prize,start_date,end_date,status,description,format_summary,created_at,group_stage_deadline_1,group_stage_deadline_2,group_stage_final_deadline,knockout_start_at,quarterfinal_deadline,semifinal_deadline,final_deadline";

const DEADLINE_KEYS = [
  "group_stage_deadline_1",
  "group_stage_deadline_2",
  "group_stage_final_deadline",
  "knockout_start_at",
  "quarterfinal_deadline",
  "semifinal_deadline",
  "final_deadline",
] as const;

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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const isFullUpdate = Object.prototype.hasOwnProperty.call(body, "title");

  const admin = getSupabaseAdmin();

  if (!isFullUpdate) {
    const status = String(body.status || "").trim().toLowerCase();
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: "status must be upcoming, active, or completed" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("esports_tournaments")
      .update({ status })
      .eq("id", id)
      .select("id,title,game,prize,start_date,end_date,status")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

    revalidatePath("/esports/tournaments");
    revalidatePath("/admin/esports");
    revalidatePath(`/esports/tournaments/${id}`);

    return NextResponse.json({ ok: true, tournament: data });
  }

  const title = String(body.title || "").trim();
  const game = String(body.game || "").trim();
  const prize = String(body.prize || "").trim();
  const description = String(body.description ?? "").trim() || null;
  const format_summary = String(body.format_summary ?? "").trim() || null;
  const status = String(body.status || "upcoming").trim().toLowerCase();

  if (!title || !game || !prize) {
    return NextResponse.json({ error: "Title, game, and prize are required." }, { status: 400 });
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be upcoming, active, or completed." }, { status: 400 });
  }

  const startR = requiredIso("start_date", body.start_date);
  if (!startR.ok) return NextResponse.json({ error: startR.message }, { status: 400 });
  const endR = requiredIso("end_date", body.end_date);
  if (!endR.ok) return NextResponse.json({ error: endR.message }, { status: 400 });

  const deadlines: Record<string, string | null> = {};
  for (const k of DEADLINE_KEYS) {
    const v = optionalIso(body[k], k);
    if (!v.ok) return NextResponse.json({ error: v.message }, { status: 400 });
    deadlines[k] = v.value;
  }

  const { data, error } = await admin
    .from("esports_tournaments")
    .update({
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
    .eq("id", id)
    .select(SELECT_LIST)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  revalidatePath(`/esports/tournaments/${id}`);

  return NextResponse.json({ ok: true, tournament: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminBearer(_req);
  if (!guard.ok) return guard.response;

  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("esports_tournaments").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath("/esports/tournaments");
  revalidatePath("/admin/esports");
  revalidatePath(`/esports/tournaments/${id}`);

  return NextResponse.json({ ok: true, deleted_id: id });
}
