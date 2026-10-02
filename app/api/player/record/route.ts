import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/admin/requireAdmin";
import { EMPTY_SUMMARY, loadPlayerRecord, loadRecordSummaries } from "@/lib/records/playerRecord";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;

/**
 * GET: pickup record from posted results.
 *   (no params) or ?userId=<self>  the caller's full record: summary, form strip and match log.
 *   ?userId=<other>                 summary only (games, W/D/L, win %, POTD), as the leaderboards show.
 *   ?userIds=a,b,c                  summaries for up to 200 players.
 * Other players must be approved; the viewer must be approved or an admin. Never score, tier or reliability.
 */
export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: auth } = await admin.auth.getUser(token);
  const viewerId = auth.user?.id;
  if (!viewerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const single = url.searchParams.get("userId")?.trim() || null;
  const many = (url.searchParams.get("userIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    if (!many.length && (!single || single === viewerId)) {
      const record = await loadPlayerRecord(admin, viewerId);
      return NextResponse.json({ ok: true, user_id: viewerId, record });
    }

    const targets = many.length ? many : [single!];
    if (targets.length > MAX_IDS || targets.some((id) => !UUID_RE.test(id))) {
      return NextResponse.json({ error: "Invalid userIds" }, { status: 400 });
    }

    const { data: viewer } = await admin.from("profiles").select("approved,is_admin").eq("id", viewerId).maybeSingle();
    if (!viewer || (viewer.approved !== true && viewer.is_admin !== true)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const visible = new Set<string>();
    for (let i = 0; i < targets.length; i += MAX_IDS) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .in("id", targets.slice(i, i + MAX_IDS))
        .eq("approved", true);
      for (const p of (data ?? []) as Array<{ id: string }>) visible.add(p.id);
    }
    if (targets.includes(viewerId)) visible.add(viewerId);

    const summaries = await loadRecordSummaries(admin, [...visible]);
    if (!many.length) {
      if (!visible.has(single!)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ ok: true, user_id: single, summary: summaries.get(single!) ?? EMPTY_SUMMARY });
    }
    const out: Record<string, typeof EMPTY_SUMMARY> = {};
    for (const id of visible) out[id] = summaries.get(id) ?? EMPTY_SUMMARY;
    return NextResponse.json({ ok: true, summaries: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[player/record] failed:", msg);
    return NextResponse.json({ error: "Could not load the record." }, { status: 500 });
  }
}
