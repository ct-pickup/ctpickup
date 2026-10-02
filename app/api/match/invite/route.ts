import { NextResponse } from "next/server";
import { matchErrorResponse } from "@/lib/match/matchRoute";
import { requireHostRunAccess, sendHostInvite } from "@/lib/match/matchService";
import { requireAuthedUser } from "@/lib/referral/auth";

export const dynamic = "force-dynamic";

/** POST { run_id, invite_token } — invite a Fill your game candidate. Idempotent per (run, invitee). */
export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as { run_id?: unknown; invite_token?: unknown } | null;
  const runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
  const token = typeof body?.invite_token === "string" ? body.invite_token.trim() : "";
  if (!runId || !token) return NextResponse.json({ error: "run_id and invite_token required" }, { status: 400 });

  try {
    const access = await requireHostRunAccess(auth.admin, runId, auth.user.id);
    const result = await sendHostInvite(auth.admin, access, auth.user.id, token);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return matchErrorResponse("invite", e);
  }
}
