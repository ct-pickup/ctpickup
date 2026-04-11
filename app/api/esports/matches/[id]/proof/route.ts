import { NextResponse } from "next/server";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { ESPORTS_MATCH_PROOFS_BUCKET } from "@/lib/esports/matchWorkflowConstants";
import { maybeEscalateConfirmationDeadline, requireEsportsService } from "@/lib/esports/matchWorkflowServer";

export const runtime = "nodejs";

/**
 * Returns a short-lived signed URL so participants (or staff) can view private proof.
 * Query: ?path=...  (storage path within bucket)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await supabaseServer();
    const user = await getAuthUserSafe(supabase);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const svc = requireEsportsService();
    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    const url = new URL(req.url);
    const path = String(url.searchParams.get("path") || "").trim();
    if (!path || path.includes("..")) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    if (!path.startsWith(`${matchId}/`)) {
      return NextResponse.json({ error: "Path does not belong to this match." }, { status: 400 });
    }

    await maybeEscalateConfirmationDeadline(svc, matchId);

    const { data: matchRaw, error: mErr } = await svc
      .from("esports_matches")
      .select("id,player1_user_id,player2_user_id")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr || !matchRaw) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const m = matchRaw as { player1_user_id: string; player2_user_id: string };
    const isParticipant = user.id === m.player1_user_id || user.id === m.player2_user_id;

    const { data: prof } = await svc.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    const isAdmin = Boolean((prof as { is_admin?: boolean } | null)?.is_admin);

    if (!isParticipant && !isAdmin) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: signed, error: sErr } = await svc.storage
      .from(ESPORTS_MATCH_PROOFS_BUCKET)
      .createSignedUrl(path, 120);

    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ error: "Could not sign URL." }, { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
