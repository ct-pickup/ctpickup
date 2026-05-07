import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

export async function DELETE(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  const { data: authData, error: authErr } = await svc.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  const { error: profileErr } = await svc.from("profiles").delete().eq("id", userId);
  if (profileErr) {
    console.error("[account/delete] profiles delete:", profileErr);
    return NextResponse.json({ ok: false, error: "Failed to delete profile" }, { status: 500 });
  }

  const { error: deleteUserErr } = await svc.auth.admin.deleteUser(userId);
  if (deleteUserErr) {
    console.error("[account/delete] auth.admin.deleteUser:", deleteUserErr);
    return NextResponse.json({ ok: false, error: "Failed to delete account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
