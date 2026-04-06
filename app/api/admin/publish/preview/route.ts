import { NextResponse } from "next/server";
import { composePublishMessage } from "@/lib/admin/publish/composePublishMessage";
import { buildPublicationPreview } from "@/lib/admin/publish/buildPreview";
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

  let body: { message?: string; label?: string | null; targets?: PublishTargetsInput };
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

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const previews = await buildPublicationPreview(admin, composed.text, targets);
  return NextResponse.json({ previews });
}
