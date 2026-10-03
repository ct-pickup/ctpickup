import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { isStarLevel } from "@/shared/starLevels";

function writeFailed(phase: string, err: unknown) {
  Sentry.captureException(err);
  console.error(`[admin/verification POST] ${phase}`, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** PostgREST / Postgres codes for a function that has not been migrated yet. */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "PGRST202" || err.code === "42883" || /could not find the function/i.test(err.message ?? ""));
}

const STATUSES = ["pending", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];
const BASE_COLUMNS = "id,user_id,claim,evidence_url,status,created_at,reviewed_at";
const LEVEL_COLUMNS = `${BASE_COLUMNS},claimed_level,approved_level`;

type RequestRow = {
  id: string;
  user_id: string;
  claim: string;
  evidence_url: string;
  status: Status;
  created_at: string;
  reviewed_at: string | null;
  claimed_level?: number | string | null;
  approved_level?: number | string | null;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  stated_level?: number | string | null;
};

function num(v: number | string | null | undefined): number | null {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Document verification requests for one status tab, newest first, merged with profiles. */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const admin = getSupabaseAdmin();

  const statusParam = new URL(req.url).searchParams.get("status") ?? "pending";
  const status: Status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as Status) : "pending";

  const list = (columns: string) =>
    admin.from("verification_requests").select(columns).eq("status", status).order("created_at", { ascending: false }).limit(100);
  let res = await list(LEVEL_COLUMNS);
  if (res.error) res = await list(BASE_COLUMNS);
  if (res.error) return writeFailed("verification_requests list", res.error);
  const rows = (res.data ?? []) as unknown as RequestRow[];

  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profiles = new Map<string, ProfileRow>();
  if (ids.length > 0) {
    const read = (columns: string) => admin.from("profiles").select(columns).in("id", ids);
    let p = await read("id,first_name,last_name,username,avatar_url,stated_level");
    if (p.error) p = await read("id,first_name,last_name,username,avatar_url");
    if (p.error) return writeFailed("profiles", p.error);
    for (const row of (p.data ?? []) as unknown as ProfileRow[]) profiles.set(row.id, row);
  }

  const items = rows.map((r) => {
    const p = profiles.get(r.user_id);
    return {
      id: r.id,
      user_id: r.user_id,
      claim: r.claim,
      evidence_url: r.evidence_url,
      status: r.status,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
      claimed_level: num(r.claimed_level),
      approved_level: num(r.approved_level),
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
      stated_level: num(p?.stated_level),
    };
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { request_id, decision, level: rawLevel } = (await req.json()) as {
    request_id: string;
    decision: "approved" | "rejected";
    level?: unknown;
  };

  if (!request_id || !["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const level = rawLevel == null ? null : typeof rawLevel === "string" ? Number(rawLevel) : rawLevel;
  if (level != null && !isStarLevel(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  const { data: vr } = await admin
    .from("verification_requests")
    .select("user_id,status")
    .eq("id", request_id)
    .maybeSingle();

  if (!vr) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (decision === "approved") {
    if (vr.status !== "pending") {
      return NextResponse.json({ error: "This request was already reviewed." }, { status: 409 });
    }
    const approved = await admin.rpc("approve_verification_with_level", {
      p_request_id: request_id,
      p_level: level,
      p_admin_id: guard.userId,
    });
    if (!approved.error) return NextResponse.json({ ok: true });
    if (!isMissingFunction(approved.error)) return writeFailed("approve_verification_with_level", approved.error);
    // Until 20261005000400 is applied: verification only, no seed.
  }

  const reviewed = await admin
    .from("verification_requests")
    .update({ status: decision, reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", request_id);
  if (reviewed.error) return writeFailed("verification_requests update", reviewed.error);

  if (decision === "approved") {
    const prof = await admin.from("profiles").update({ verification_level: "document" }).eq("id", vr.user_id);
    if (prof.error) return writeFailed("profiles update", prof.error);
    const rating = await admin.from("player_ratings")
      .upsert({ user_id: vr.user_id, verification: "document", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (rating.error) return writeFailed("player_ratings upsert", rating.error);
  }

  return NextResponse.json({ ok: true });
}
