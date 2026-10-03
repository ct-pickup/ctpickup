import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { bearer, IG_VERIFY_TABLE, isMissingSchema, unavailableResponse } from "@/lib/verification/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "account/instagram-visibility";

function failed(phase: string, err: unknown) {
  Sentry.captureException(err instanceof Error ? err : new Error(`[${ROUTE}] ${phase}: ${JSON.stringify(err)}`));
  console.error(`[api/${ROUTE}] ${phase}`, err);
  return NextResponse.json({ error: "Couldn't save that. Try again in a moment." }, { status: 500 });
}

/**
 * "Show Instagram on my profile". profiles.instagram_handle holds the verified handle only while it is shown,
 * because approved players can read each other's profiles rows directly; the canonical handle stays in
 * instagram_verification_requests, which clients cannot read.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  const auth = token ? await admin.auth.getUser(token) : null;
  const userId = auth && !auth.error ? auth.data.user?.id ?? null : null;
  if (!userId) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });

  let body: { show?: unknown };
  try {
    body = (await req.json()) as { show?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.show !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const show = body.show;

  const [prof, approved] = await Promise.all([
    admin.from("profiles").select("verification_level").eq("id", userId).maybeSingle(),
    admin
      .from(IG_VERIFY_TABLE)
      .select("handle")
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false })
      .limit(1),
  ]);
  if (isMissingSchema(approved.error)) return unavailableResponse();
  if (prof.error) return failed("profile", prof.error);
  if (approved.error) return failed("approved request", approved.error);

  const level = (prof.data as { verification_level?: string | null } | null)?.verification_level ?? "self";
  const handle = ((approved.data ?? []) as { handle: string }[])[0]?.handle ?? null;
  if (show && (level !== "instagram" || !handle)) {
    return NextResponse.json({ error: "Verify your Instagram first." }, { status: 409 });
  }

  const upd = await admin
    .from("profiles")
    .update({ show_instagram: show, instagram_handle: show ? handle : null })
    .eq("id", userId);
  if (isMissingSchema(upd.error)) return unavailableResponse();
  if (upd.error) return failed("update", upd.error);

  return NextResponse.json({ show_instagram: show });
}
