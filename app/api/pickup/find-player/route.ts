import { NextResponse } from "next/server";
import { lookupPickupPlayerByUsernameOrEmail } from "@/lib/pickup/lookupPlayerByIdentifier";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Lookup a player by username or email (same resolution as pickup RSVP `friend_identifier`).
 * Any authenticated user may call; returns minimal fields for "pay for a friend" UX.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "Missing q (username or email)." }, { status: 400 });

  const row = await lookupPickupPlayerByUsernameOrEmail(admin, q);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    user_id: row.user_id,
    full_name: row.full_name,
    username: row.username,
  });
}
