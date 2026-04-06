import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { executePublication } from "@/lib/admin/publish/executePublication";
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
    targets?: PublishTargetsInput;
    idempotency_key?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = String(body.message || "");
  const targets = body.targets || {};
  if (!hasAnyTarget(targets)) {
    return NextResponse.json({ error: "Select at least one target." }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const result = await executePublication({
      admin,
      userId: guard.userId,
      message,
      targets,
      idempotencyKey: body.idempotency_key?.trim() || null,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
