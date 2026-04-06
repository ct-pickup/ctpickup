import { NextResponse } from "next/server";
import { composePublishMessage } from "@/lib/admin/publish/composePublishMessage";
import { executePublication } from "@/lib/admin/publish/executePublication";
import {
  effectsFromPublication,
  verifyLinksFromTargets,
} from "@/lib/admin/publish/publicationResponse";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import type { PublishTargetsInput } from "@/lib/admin/publish/types";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function hasAnyTarget(t: PublishTargetsInput) {
  return !!(
    t.siteStatus ||
    t.pickupGlobal ||
    t.tournamentActive ||
    (t.pickupRunIds && t.pickupRunIds.length > 0)
  );
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  let body: {
    message?: string;
    label?: string | null;
    targets?: PublishTargetsInput;
    idempotency_key?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targets = body.targets || {};
  if (!hasAnyTarget(targets)) {
    return NextResponse.json({ error: "Select at least one destination." }, { status: 400 });
  }

  const composed = composePublishMessage(String(body.message || ""), body.label);
  if (!composed.ok) {
    return NextResponse.json({ error: composed.error }, { status: 400 });
  }

  const runIds = Array.from(
    new Set((targets.pickupRunIds || []).map((x) => String(x).trim()).filter(Boolean)),
  );
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  for (const runId of runIds) {
    const runRes = await admin.from("pickup_runs").select("id,status").eq("id", runId).maybeSingle();
    if (!runRes.data) {
      return NextResponse.json({ error: "Pickup run not found." }, { status: 400 });
    }
    if (runRes.data.status === "canceled") {
      return NextResponse.json({ error: "Cannot publish to a canceled pickup run." }, { status: 400 });
    }
  }

  try {
    const result = await executePublication({
      admin,
      userId: guard.userId,
      message: composed.text,
      targets,
      idempotencyKey: body.idempotency_key?.trim() || null,
    });
    return NextResponse.json({
      ...result,
      effects: effectsFromPublication(result),
      verify: verifyLinksFromTargets(targets),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
