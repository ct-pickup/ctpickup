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
 * PostgREST `or=(…)` splits on commas; ilike patterns that contain spaces or commas must be
 * double-quoted. Escape `"` inside the value by doubling (CSV-style).
 */
function orClauseUsernameOrNameIlike(pattern: string): string {
  const escaped = pattern.replace(/"/g, '""');
  const q = `"${escaped}"`;
  return `username.ilike.${q},first_name.ilike.${q},last_name.ilike.${q}`;
}

/**
 * Search players by username or name (substring match). Any authenticated user may call.
 * Returns up to `limit` rows: profile fields plus legacy `user_id` / `full_name` for mobile clients.
 */
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const sessionUserId = u.data.user?.id;
  if (!sessionUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    .select("id, first_name, last_name, username, nearest_venue")
    .eq("approved", true)
    .eq("is_banned", false)
    .neq("id", sessionUserId)
    .or(orClauseUsernameOrNameIlike(pattern))
    .order("first_name", { ascending: true })
    .limit(limit);

  if (error) {
    console.log(
      "[pickup/find-player] Supabase error:",
      JSON.stringify(
        {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
        null,
        2,
      ),
    );
    return NextResponse.json({ error: "Could not search." }, { status: 500 });
  }

  const rows = data || [];
  const out = rows.map((row) => {
    const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    return {
      id: row.id as string,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      username: typeof row.username === "string" && row.username.length > 0 ? row.username : null,
      nearest_venue: typeof row.nearest_venue === "string" ? row.nearest_venue : null,
      user_id: row.id as string,
      full_name:
        fullName.length > 0
          ? fullName
          : typeof row.username === "string" && row.username
            ? row.username
            : "Player",
    };
  });

  return NextResponse.json(out);
}
