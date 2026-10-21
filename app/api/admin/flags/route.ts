import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { changeFlag, listFlags } from "@/lib/flagsAdmin";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/flags: both switches, their allowlists (with emails) and the last 20 changes. Admin only. */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ ok: true, ...(await listFlags(supabaseService())) });
  } catch {
    return NextResponse.json({ error: "Could not load the flags. Has the app_flags migration been run?" }, { status: 500 });
  }
}

/**
 * POST /api/admin/flags  { key, enabled?, add_email?, remove_id? }
 * Turns a switch on or off for everyone, or adds a player (by email, resolved here) to / removes one from its allowlist.
 * Each change is logged in app_flag_events. Admin only.
 */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const res = await changeFlag(supabaseService(), guard.userId, { key: body.key, enabled: body.enabled, add_email: body.add_email, remove_id: body.remove_id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, flag: res.flag });
}
