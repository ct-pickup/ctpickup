import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import { getSupabaseAnon } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || body.acknowledge !== true) {
    return NextResponse.json({ error: "acknowledgment_required" }, { status: 400 });
  }

  const anon = getSupabaseAnon();
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
    const err = error as {
      message?: string;
      code?: string;
      details?: string | null;
      hint?: string | null;
    };
    console.error(
      "[waiver/accept]",
      JSON.stringify({
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
      })
    );
    if (
      typeof err.message === "string" &&
      err.message.includes("schema cache")
    ) {
      console.error(
        "[waiver/accept] Table missing from PostgREST schema: apply Supabase migrations (e.g. supabase db push) so public.user_waiver_acceptance exists."
      );
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  try {
    await recomputePickupStandingForUser(svc, u.user.id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[waiver/accept] standing recompute:", msg);
  }

  return NextResponse.json({
    ok: true,
    version: CURRENT_WAIVER_VERSION,
  });
}
