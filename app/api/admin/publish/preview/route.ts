import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { buildPublicationPreview } from "@/lib/admin/publish/buildPreview";
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

  let body: { message?: string; targets?: PublishTargetsInput };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

  const previews = await buildPublicationPreview(admin, String(body.message || ""), targets);
  return NextResponse.json({ previews });
}
