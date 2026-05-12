import { NextResponse } from "next/server";
import { ensureProfileRowForAuthUser } from "@/lib/profile/ensureProfileRowForAuthUser";
import { isMissingProfileColumnError } from "@/lib/profileLoad";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSITIONS = new Set(["Goalkeeper", "Defender", "Midfielder", "Attacker"]);

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

function formatSupabaseError(err: { message?: string; details?: string; hint?: string; code?: string }): string {
  const parts = [err.message, err.details, err.hint].filter((s) => typeof s === "string" && s.trim());
  if (parts.length) return parts.join(" — ");
  if (err.code) return `Error code ${err.code}`;
  return "Unknown Supabase error";
}

function looksLikeMissingNearestVenueColumn(err: { message?: string } | null | undefined): boolean {
  const msg = err?.message ?? "";
  if (!msg) return false;
  return /nearest_venue/i.test(msg) && isMissingProfileColumnError(msg);
}

function sanitizeNearestVenue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t.length) return null;
  return t.slice(0, 500);
}

function sanitizeZip(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "").slice(0, 5);
  return d.length === 5 ? d : null;
}

function sanitizePlayingPosition(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  return POSITIONS.has(v) ? v : null;
}

function sanitizeText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t.length) return null;
  return t.slice(0, max);
}

export async function PATCH(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  console.log("[account/profile] PATCH incoming body:", JSON.stringify(body));

  const admin = getSupabaseAdmin();
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user?.id) {
    console.log("[account/profile] auth.getUser failed:", authErr?.message ?? "no user");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Body must be a JSON object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const first_name = sanitizeText(b.first_name, 120);
  const last_name = sanitizeText(b.last_name, 120);
  const playing_position = sanitizePlayingPosition(b.playing_position);
  const instagram = sanitizeText(b.instagram, 200)?.replace(/^@/, "") ?? null;
  const phone = sanitizeText(b.phone, 40);
  const zip_code = sanitizeZip(b.zip_code);
  const username = sanitizeText(b.username, 64);
  const nearest_venue = sanitizeNearestVenue(b.nearest_venue);

  const updatedAt = new Date().toISOString();
  const coreUpdate = {
    first_name,
    last_name,
    playing_position,
    instagram,
    phone,
    zip_code,
    username,
    updated_at: updatedAt,
  };

  await ensureProfileRowForAuthUser({ id: userId, email: user.email ?? null });

  const withVenue = { ...coreUpdate, nearest_venue };
  let res = await admin.from("profiles").update(withVenue).eq("id", userId).select("id");

  console.log(
    "[account/profile] Supabase update response:",
    JSON.stringify({ data: res.data, error: res.error, rowCount: res.data?.length ?? 0 }),
  );

  if (res.error && looksLikeMissingNearestVenueColumn(res.error)) {
    console.log("[account/profile] retrying update without nearest_venue:", res.error.message);
    res = await admin.from("profiles").update(coreUpdate).eq("id", userId).select("id");
    console.log(
      "[account/profile] Supabase update (no venue) response:",
      JSON.stringify({ data: res.data, error: res.error, rowCount: res.data?.length ?? 0 }),
    );
  }

  if (res.error) {
    const msg = formatSupabaseError(res.error);
    console.error("[account/profile] update error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  if (!res.data?.length) {
    const msg =
      "Save did not update any profile row (no match, RLS blocked update, or missing profile row).";
    console.error("[account/profile] update returned 0 rows for userId:", userId);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
