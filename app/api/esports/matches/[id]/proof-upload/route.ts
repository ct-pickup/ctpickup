import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import {
  ESPORTS_MATCH_PROOFS_BUCKET,
  PROOF_ALLOWED_MIME,
  PROOF_MAX_BYTES,
} from "@/lib/esports/matchWorkflowConstants";
import { maybeEscalateConfirmationDeadline, requireEsportsService } from "@/lib/esports/matchWorkflowServer";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

export const runtime = "nodejs";

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await supabaseServer();
    const user = await getAuthUserSafe(supabase);
    if (!user) return NextResponse.json({ error: "You must be logged in." }, { status: 401 });

    const svc = requireEsportsService();
    const { id } = await ctx.params;
    const matchId = String(id || "").trim();
    if (!matchId) return NextResponse.json({ error: "Missing match id." }, { status: 400 });

    await maybeEscalateConfirmationDeadline(svc, matchId);

    const { data: matchRaw, error: mErr } = await svc
      .from("esports_matches")
      .select("id,player1_user_id,player2_user_id,status")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr || !matchRaw) return NextResponse.json({ error: "Match not found." }, { status: 404 });

    const match = matchRaw as {
      player1_user_id: string;
      player2_user_id: string;
      status: EsportsMatchWorkflowStatus;
    };

    if (user.id !== match.player1_user_id && user.id !== match.player2_user_id) {
      return NextResponse.json({ error: "You do not have access to this match." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Expected multipart field \"file\"." }, { status: 400 });
    }

    if (file.size <= 0 || file.size > PROOF_MAX_BYTES) {
      return NextResponse.json({ error: `File must be under ${PROOF_MAX_BYTES / (1024 * 1024)} MiB.` }, { status: 400 });
    }

    const mime = (file.type || "").toLowerCase();
    if (!PROOF_ALLOWED_MIME.has(mime)) {
      return NextResponse.json({ error: "Only JPEG, PNG, or WebP images are allowed." }, { status: 400 });
    }

    if (match.status === "scheduled") {
      // ok — reporter preparing proof before submit
    } else if (match.status === "awaiting_confirmation") {
      const { data: rep } = await svc
        .from("esports_match_reports")
        .select("reporter_user_id,opponent_response")
        .eq("match_id", matchId)
        .maybeSingle();
      const r = rep as { reporter_user_id: string; opponent_response: string } | null;
      if (!r || r.opponent_response !== "pending" || r.reporter_user_id !== user.id) {
        return NextResponse.json(
          { error: "Only the reporting player can replace proof while confirmation is pending." },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json({ error: "Proof cannot be uploaded for this match state." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const objectPath = `${matchId}/${randomUUID()}.${extForMime(mime)}`;

    const { error: upErr } = await svc.storage.from(ESPORTS_MATCH_PROOFS_BUCKET).upload(objectPath, buf, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) return NextResponse.json({ error: "Upload failed." }, { status: 500 });

    return NextResponse.json({ ok: true, screenshot_storage_path: objectPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
