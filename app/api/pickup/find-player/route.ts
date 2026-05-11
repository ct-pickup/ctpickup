import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** Strip ILIKE wildcards from user input so filters stay bounded and predictable. */
function sanitizeIlike(raw: string) {
  return raw.replace(/%/g, "").replace(/_/g, "").replace(/,/g, "");
}

/**
 * Search players by username or name (substring match). Any authenticated user may call.
 * Returns up to `limit` rows: `{ user_id, full_name, username }[]`.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  if (!u.data.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limitParam = Number(url.searchParams.get("limit") || "5");
  const limit = Number.isFinite(limitParam) ? Math.min(5, Math.max(1, Math.floor(limitParam))) : 5;

  if (!q) return NextResponse.json([]);

  const needle = sanitizeIlike(q);
  if (!needle) return NextResponse.json([]);

  const pattern = `%${needle}%`;
  const { data, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name, username")
    .or(`username.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`)
    .order("first_name", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[pickup/find-player]", error.message);
    return NextResponse.json({ error: "Could not search." }, { status: 500 });
  }

  const rows = data || [];
  const out = rows.map((row) => {
    const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    return {
      user_id: row.id as string,
      full_name: fullName.length > 0 ? fullName : (typeof row.username === "string" && row.username ? row.username : "Player"),
      username: typeof row.username === "string" && row.username.length > 0 ? row.username : null,
    };
  });

  return NextResponse.json(out);
}
