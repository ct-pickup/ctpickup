import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import {
  IG_VERIFY_TABLE,
  instagramVerifySecretConfigured,
  isMissingSchema,
  isVerificationExpired,
  unavailableResponse,
  verificationCodeMatches,
} from "@/lib/verification/instagram";
import {
  normalizeVerificationCodeInput,
  type InstagramVerificationQueueItem,
  type InstagramVerificationStatus,
} from "@/shared/instagramVerification";
import { isStarLevel } from "@/shared/starLevels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "admin/instagram-verification";
const QUEUE_COLUMNS = "id,user_id,handle,code_hint,status,created_at,expires_at,reviewed_at,reject_reason";
const REASON_MAX = 500;

type QueueRow = Omit<InstagramVerificationQueueItem, "name" | "username" | "avatar_url">;
type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function failed(phase: string, err: unknown) {
  Sentry.captureException(err instanceof Error ? err : new Error(`[${ROUTE}] ${phase}: ${JSON.stringify(err)}`));
  console.error(`[api/${ROUTE}] ${phase}`, err);
  return NextResponse.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
}

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = getSupabaseAdmin();

  const [pending, reviewed] = await Promise.all([
    admin.from(IG_VERIFY_TABLE).select(QUEUE_COLUMNS).eq("status", "pending").order("created_at", { ascending: true }).limit(100),
    admin
      .from(IG_VERIFY_TABLE)
      .select(QUEUE_COLUMNS)
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(30),
  ]);
  if (isMissingSchema(pending.error) || isMissingSchema(reviewed.error)) return unavailableResponse();
  if (pending.error) return failed("pending", pending.error);
  if (reviewed.error) return failed("reviewed", reviewed.error);

  const now = new Date();
  const rows = [
    ...((pending.data ?? []) as QueueRow[]).filter((r) => !isVerificationExpired(r, now)),
    ...((reviewed.data ?? []) as QueueRow[]),
  ];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profiles = ids.length
    ? await admin.from("profiles").select("id,first_name,last_name,username,avatar_url").in("id", ids)
    : { data: [], error: null };
  if (profiles.error) return failed("profiles", profiles.error);
  const byId = new Map(((profiles.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  const items: InstagramVerificationQueueItem[] = rows.map((r) => {
    const p = byId.get(r.user_id);
    return {
      id: r.id,
      user_id: r.user_id,
      handle: r.handle,
      code_hint: r.code_hint,
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
      reviewed_at: r.reviewed_at ?? null,
      reject_reason: r.reject_reason ?? null,
      name: [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.username || "Player",
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  });
  return NextResponse.json({ items });
}

type Body = { request_id?: unknown; decision?: unknown; code?: unknown; reason?: unknown; level?: unknown };

/** Lowest starting level an admin can pick on approval (Beginner). */
const MIN_START_LEVEL = 1.0;

/** PostgREST / Postgres codes for a function that has not been migrated yet. */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "PGRST202" || err.code === "42883" || /could not find the function/i.test(err.message ?? ""));
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = getSupabaseAdmin();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const decision = body.decision;
  if (!requestId || (decision !== "approve" && decision !== "reject")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const code = decision === "approve" ? normalizeVerificationCodeInput(body.code) : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (decision === "approve" && !code) {
    return NextResponse.json({ error: "Enter the 6-character code from the DM." }, { status: 400 });
  }
  const level = typeof body.level === "string" ? Number(body.level) : body.level;
  if (decision === "approve" && !(isStarLevel(level) && level >= MIN_START_LEVEL)) {
    return NextResponse.json({ error: "Choose a starting level, Beginner through Pro." }, { status: 400 });
  }
  if (decision === "reject" && !reason) {
    return NextResponse.json({ error: "Add a reason so the player knows what to fix." }, { status: 400 });
  }
  if (reason.length > REASON_MAX) {
    return NextResponse.json({ error: `Keep the reason under ${REASON_MAX} characters.` }, { status: 400 });
  }

  const found = await admin
    .from(IG_VERIFY_TABLE)
    .select("id,user_id,handle,status,code_hash,expires_at")
    .eq("id", requestId)
    .maybeSingle();
  if (isMissingSchema(found.error)) return unavailableResponse();
  if (found.error) return failed("load", found.error);
  const row = found.data as {
    id: string;
    user_id: string;
    status: InstagramVerificationStatus;
    code_hash: string;
    expires_at: string;
  } | null;
  if (!row) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });

  const reviewedAt = new Date().toISOString();

  if (decision === "reject") {
    const upd = await admin
      .from(IG_VERIFY_TABLE)
      .update({ status: "rejected", reject_reason: reason, reviewed_by: guard.userId, reviewed_at: reviewedAt })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (upd.error) return failed("reject", upd.error);
    if ((upd.data ?? []).length === 0) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  if (isVerificationExpired(row, new Date())) {
    await admin.from(IG_VERIFY_TABLE).update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
    return NextResponse.json(
      { error: "This code has expired. The player needs to request a new one." },
      { status: 409 },
    );
  }
  if (!instagramVerifySecretConfigured()) {
    Sentry.captureMessage(`[${ROUTE}] INSTAGRAM_VERIFY_SECRET is not set`, "error");
    return unavailableResponse();
  }
  if (!verificationCodeMatches(code!, row.code_hash)) {
    return NextResponse.json({ error: "That code doesn't match this request." }, { status: 400 });
  }

  const claimed = await admin
    .from(IG_VERIFY_TABLE)
    .update({ status: "approved", reviewed_by: guard.userId, reviewed_at: reviewedAt })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (claimed.error) return failed("claim", claimed.error);
  if ((claimed.data ?? []).length === 0) return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });

  const release = () =>
    admin
      .from(IG_VERIFY_TABLE)
      .update({ status: "pending", reviewed_by: null, reviewed_at: null })
      .eq("id", row.id)
      .eq("status", "approved");

  const before = await admin.from("profiles").select("verification_level").eq("id", row.user_id).maybeSingle();
  if (before.error) {
    await release();
    return failed("profile before", before.error);
  }
  const priorLevel = (before.data as { verification_level?: string | null } | null)?.verification_level ?? "self";

  const prof = await admin.from("profiles").update({ verification_level: "instagram" }).eq("id", row.user_id);
  if (prof.error) {
    await release();
    return isMissingSchema(prof.error) ? unavailableResponse() : failed("profiles update", prof.error);
  }
  // Seeds the chosen level and lifts the 3.0 cap only for a level above it. Never lifts silently.
  const rating = await admin.rpc("approve_instagram_with_level", {
    p_user_id: row.user_id,
    p_level: level,
    p_admin_id: guard.userId,
  });
  if (rating.error) {
    await admin.from("profiles").update({ verification_level: priorLevel }).eq("id", row.user_id);
    await release();
    return isMissingSchema(rating.error) || isMissingFunction(rating.error)
      ? unavailableResponse()
      : failed("approve_instagram_with_level", rating.error);
  }

  return NextResponse.json({ ok: true, status: "approved" });
}
