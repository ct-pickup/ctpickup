import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json();

  const startAt = String(b.start_at || "");
  if (!startAt) return NextResponse.json({ error: "start_at required" }, { status: 400 });

  const insert = await supabaseAdmin.from("pickup_runs").insert({
    title: b.title || "CT Pickup Run",
    run_type: b.run_type || "select",
    status: "planning",
    start_at: startAt,
    capacity: Number(b.capacity || 24),
    fee_cents: Number(b.fee_cents || 0),
    currency: "usd",
    location_text: b.location_text || null,
    cancellation_deadline: b.cancellation_deadline || null,
    invite_phase: 0,
    phase_opened_at: new Date().toISOString(),
    created_by: user.id,
  }).select("*").single();

  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, run: insert.data });
}
