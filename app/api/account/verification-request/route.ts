import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const claim = String(body.claim ?? "").trim();
  const evidence_url = String(body.evidence_url ?? "").trim();

  if (!claim) return NextResponse.json({ error: "claim is required." }, { status: 400 });
  if (!evidence_url) return NextResponse.json({ error: "evidence_url is required." }, { status: 400 });

  // Check for existing pending request
  const { data: existing } = await admin
    .from("verification_requests")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "You already have a pending verification request." }, { status: 409 });
  }

  const { error: insertErr } = await admin
    .from("verification_requests")
    .insert({
      user_id: user.id,
      claim,
      evidence_url,
      status: "pending",
      created_at: new Date().toISOString(),
    });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
