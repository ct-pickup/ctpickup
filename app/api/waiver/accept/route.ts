import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseService } from "@/lib/supabase/service";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || body.acknowledge !== true) {
    return NextResponse.json({ error: "acknowledgment_required" }, { status: 400 });
  }

  const anon = createClient(supabaseUrl, anonKey);
  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) {
    return NextResponse.json({ error: "invalid_auth" }, { status: 401 });
  }

  const svc = supabaseService();
  const { error } = await svc.from("user_waiver_acceptance").upsert(
    {
      user_id: u.user.id,
      version: CURRENT_WAIVER_VERSION,
      accepted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,version" }
  );

  if (error) {
    console.error("[waiver/accept]", error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    version: CURRENT_WAIVER_VERSION,
  });
}
