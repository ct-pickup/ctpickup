import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdminUserIds } from "@/lib/push/adminUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { checkPersistentRateLimitStrict } from "@/lib/server/persistentRateLimit";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import {
  bearer,
  CODE_RATE_LIMIT,
  generateVerificationCode,
  hashVerificationCode,
  IG_VERIFY_TABLE,
  instagramVerifySecretConfigured,
  isMissingSchema,
  isUniqueViolation,
  isVerificationExpired,
  openVerificationCode,
  sealVerificationCode,
  unavailableResponse,
  verificationCodeHint,
  verificationExpiresAt,
} from "@/lib/verification/instagram";
import {
  formatVerificationCode,
  normalizeInstagramHandle,
  type InstagramVerificationState,
  type InstagramVerificationStatus,
} from "@/shared/instagramVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "account/instagram-verification";
const CODE_ATTEMPTS = 5;

type RequestRow = {
  id: string;
  handle: string;
  status: InstagramVerificationStatus;
  code_ciphertext: string | null;
  expires_at: string;
  reject_reason: string | null;
};

function failed(phase: string, err: unknown) {
  Sentry.captureException(err instanceof Error ? err : new Error(`[${ROUTE}] ${phase}: ${JSON.stringify(err)}`));
  console.error(`[api/${ROUTE}] ${phase}`, err);
  return NextResponse.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
}

async function authUserId(admin: SupabaseClient, req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

function secretMissing() {
  Sentry.captureMessage(`[${ROUTE}] INSTAGRAM_VERIFY_SECRET is not set`, "error");
  return unavailableResponse();
}

type Loaded =
  | { ok: true; state: InstagramVerificationState }
  | { ok: false; response: Response };

async function loadState(admin: SupabaseClient, userId: string): Promise<Loaded> {
  const [prof, igProf, latest] = await Promise.all([
    admin.from("profiles").select("verification_level").eq("id", userId).maybeSingle(),
    admin.from("profiles").select("show_instagram").eq("id", userId).maybeSingle(),
    admin
      .from(IG_VERIFY_TABLE)
      .select("id,handle,status,code_ciphertext,expires_at,reject_reason")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (isMissingSchema(igProf.error) || isMissingSchema(latest.error)) return { ok: false, response: unavailableResponse() };
  if (prof.error) return { ok: false, response: failed("profile", prof.error) };
  if (igProf.error) return { ok: false, response: failed("profile instagram", igProf.error) };
  if (latest.error) return { ok: false, response: failed("latest request", latest.error) };

  const level = (prof.data as { verification_level?: string | null } | null)?.verification_level ?? "self";
  const recent = (latest.data ?? []) as RequestRow[];
  const row = recent.find((r) => r.status === "pending") ?? recent[0] ?? null;
  let status: InstagramVerificationStatus = row?.status ?? "none";
  if (status === "pending" && row && isVerificationExpired(row, new Date())) status = "expired";

  let code: string | null = null;
  if (status === "pending" && row?.code_ciphertext) {
    const plain = openVerificationCode(row.code_ciphertext, userId);
    if (plain) code = formatVerificationCode(plain);
    else Sentry.captureMessage(`[${ROUTE}] could not open code for request ${row.id}`, "error");
  }

  return {
    ok: true,
    state: {
      status,
      handle: row?.handle ?? null,
      code,
      expires_at: row?.expires_at ?? null,
      reject_reason: status === "rejected" ? row?.reject_reason ?? null : null,
      verified: level === "instagram",
      verified_other: level === "document" || level === "vouched",
      show_instagram: (igProf.data as { show_instagram?: boolean | null } | null)?.show_instagram === true,
    },
  };
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const userId = await authUserId(admin, req);
  if (!userId) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  if (!instagramVerifySecretConfigured()) return secretMissing();

  const loaded = await loadState(admin, userId);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json(loaded.state);
}

async function notifyAdmins(admin: SupabaseClient, userId: string, handle: string) {
  try {
    const adminResult = await fetchAdminUserIds(admin);
    if (!("ids" in adminResult) || adminResult.ids.length === 0) return;
    const { data: p } = await admin.from("profiles").select("first_name,last_name,username").eq("id", userId).maybeSingle();
    const prof = p as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
    const name = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") || prof?.username || "A player";
    await sendPushToUsers(admin, adminResult.ids, {
      title: "Instagram verification",
      body: `${name} is verifying @${handle}.`,
      data: { screen: "admin/verification" },
    });
  } catch (e) {
    console.error(`[api/${ROUTE}] admin push`, e);
  }
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const userId = await authUserId(admin, req);
  if (!userId) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });

  let body: { handle?: unknown };
  try {
    body = (await req.json()) as { handle?: unknown };
  } catch {
    body = {};
  }
  const handle = normalizeInstagramHandle(body.handle);
  if (!handle) {
    return NextResponse.json(
      { error: "Enter your Instagram username: letters, numbers, periods and underscores, up to 30 characters." },
      { status: 400 },
    );
  }
  if (!instagramVerifySecretConfigured()) return secretMissing();

  const prof = await admin.from("profiles").select("verification_level").eq("id", userId).maybeSingle();
  if (prof.error) return failed("profile", prof.error);
  const level = (prof.data as { verification_level?: string | null } | null)?.verification_level ?? "self";
  if (level === "instagram") return NextResponse.json({ error: "Your Instagram is already verified." }, { status: 409 });
  if (level !== "self") return NextResponse.json({ error: "Your profile is already verified." }, { status: 409 });

  const now = new Date();
  const expired = await admin
    .from(IG_VERIFY_TABLE)
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .lte("expires_at", now.toISOString());
  if (isMissingSchema(expired.error)) return unavailableResponse();
  if (expired.error) return failed("expire stale", expired.error);

  const pending = await admin
    .from(IG_VERIFY_TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(1);
  if (pending.error) return failed("pending lookup", pending.error);
  if ((pending.data ?? []).length > 0) {
    return NextResponse.json({ error: "You already have a code waiting for review." }, { status: 409 });
  }

  const rl = await checkPersistentRateLimitStrict(admin, {
    bucketKey: `ig-verify-code:${userId}`,
    ...CODE_RATE_LIMIT,
  });
  if (!rl.ok && rl.reason === "limited") {
    return NextResponse.json(
      { error: "You've asked for a lot of codes today. Try again tomorrow." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }
  if (!rl.ok) {
    Sentry.captureMessage(`[${ROUTE}] rate limit unavailable: ${rl.error}`, "error");
    return NextResponse.json({ error: "Couldn't create a code right now. Try again later." }, { status: 503 });
  }

  const expiresAt = verificationExpiresAt(now);
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateVerificationCode();
    const ins = await admin.from(IG_VERIFY_TABLE).insert({
      user_id: userId,
      handle,
      code_hash: hashVerificationCode(code),
      code_hint: verificationCodeHint(code),
      code_ciphertext: sealVerificationCode(code, userId),
      status: "pending",
      expires_at: expiresAt,
    });
    if (!ins.error) {
      await notifyAdmins(admin, userId, handle);
      const loaded = await loadState(admin, userId);
      if (!loaded.ok) return loaded.response;
      return NextResponse.json(loaded.state, { status: 201 });
    }
    if (isUniqueViolation(ins.error, "code_hash")) continue;
    if (isUniqueViolation(ins.error, "ig_verify_one_pending_per_user")) {
      return NextResponse.json({ error: "You already have a code waiting for review." }, { status: 409 });
    }
    if (isMissingSchema(ins.error)) return unavailableResponse();
    return failed("insert", ins.error);
  }
  return failed("insert", new Error("code_hash collided on every attempt"));
}
