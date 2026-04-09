import { NextResponse } from "next/server";
import { markDashboardHomeSeen } from "@/lib/profile/markDashboardHomeSeen";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await markDashboardHomeSeen(user.id, undefined, {
    email: user.email,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Update failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
