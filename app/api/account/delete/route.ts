import { NextResponse } from "next/server";
import {
  ACCOUNT_DELETE_SUPPORT_ERROR,
  deleteUserAccount,
} from "@/lib/account/deleteUserAccount";
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

  try {
    await deleteUserAccount(svc, user.id, user.email);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[account/delete]", e);
    return NextResponse.json({ ok: false, error: ACCOUNT_DELETE_SUPPORT_ERROR }, { status: 500 });
  }
}
