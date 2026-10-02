import { NextResponse } from "next/server";
import {
  ACCOUNT_DELETE_SUPPORT_ERROR,
  AccountDeletionError,
  deleteUserAccount,
  previewAccountDeletion,
} from "@/lib/account/deleteUserAccount";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

async function authedUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const svc = supabaseService();
  const { data: authData, error: authErr } = await svc.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user?.id) return null;
  return { svc, user };
}

/** Preview: how many upcoming games and hosted runs deleting would give up. Changes nothing. */
export async function GET(req: Request) {
  const authed = await authedUser(req);
  if (!authed) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const preview = await previewAccountDeletion(authed.svc, authed.user.id);
    return NextResponse.json({ ok: true, preview });
  } catch (e: unknown) {
    console.error("[account/delete preview]", e);
    return NextResponse.json({ ok: false, error: ACCOUNT_DELETE_SUPPORT_ERROR }, { status: 500 });
  }
}

/** Deletes the caller's account. With upcoming games or hosted runs the body must include confirm_upcoming: true. */
export async function DELETE(req: Request) {
  const authed = await authedUser(req);
  if (!authed) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { confirm_upcoming?: unknown } | null;

  try {
    await deleteUserAccount(authed.svc, authed.user.id, authed.user.email, {
      confirmUpcoming: body?.confirm_upcoming === true,
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof AccountDeletionError) {
      return NextResponse.json({ ok: false, code: e.code, error: e.message, ...e.extra }, { status: e.status });
    }
    console.error("[account/delete]", e);
    return NextResponse.json({ ok: false, error: ACCOUNT_DELETE_SUPPORT_ERROR }, { status: 500 });
  }
}
