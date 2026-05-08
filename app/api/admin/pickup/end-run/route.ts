import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
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

  // Prefer setting `is_completed` when present; fall back to status-only for older schemas.
  const preferred = await supabase
    .from("pickup_runs")
    .update({ is_completed: true, status: "completed", updated_at: now })
    .eq("id", run_id)
    .select("id,status,is_completed")
    .maybeSingle();

  if (preferred.error) {
    const msg = preferred.error.message || "Update failed";
    const missingCol = /is_completed/i.test(msg) && (/column/i.test(msg) || /schema cache/i.test(msg) || /Could not find/i.test(msg));
    if (!missingCol) return NextResponse.json({ error: msg }, { status: 500 });

    const fallback = await supabase
      .from("pickup_runs")
      .update({ status: "completed", updated_at: now })
      .eq("id", run_id)
      .select("id,status")
      .maybeSingle();

    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, run: fallback.data, mode: "status_only" });
  }

  return NextResponse.json({ ok: true, run: preferred.data, mode: "status_and_is_completed" });
}

