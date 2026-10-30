import { NextResponse } from "next/server";

import { requireFlag } from "@/lib/flags";
import { requireAuthedUser } from "@/lib/referral/auth";
import { confirmResult, loadConfirmState } from "@/lib/results/resultConfirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET ?run_id=  Where confirmation of the posted score stands, and whether this player can confirm. Behind 'rating_results'. */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "rating_results", auth.user.id);
  if (off) return off;
  const runId = (new URL(req.url).searchParams.get("run_id") ?? "").trim();
  if (!UUID.test(runId)) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await loadConfirmState(auth.admin, runId, auth.user.id)) });
}

/** POST { run_id }  The captain of a team confirms the posted score. Behind 'rating_results'. */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "rating_results", auth.user.id);
  if (off) return off;
  const body = (await req.json().catch(() => null)) as { run_id?: unknown } | null;
  const runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
  if (!UUID.test(runId)) return NextResponse.json({ error: "run_id required" }, { status: 400 });
  const r = await confirmResult(auth.admin, runId, auth.user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.state });
}
