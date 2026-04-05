import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin({
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ exists: false, error: "invalid_email" }, { status: 400 });
    }

    // Reliable across supabase-js versions: listUsers (server only)
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return NextResponse.json({ exists: false, error: error.message }, { status: 500 });

    const exists = (data?.users || []).some((u) => (u.email || "").toLowerCase() === email);
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false, error: "bad_request" }, { status: 400 });
  }
}
