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

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Search players by username or name (substring match).
 * Authenticates with the logged-in user's JWT (Authorization: Bearer), not admin bearer.
 *
 * Query: ?q=searchterm&run_id=<uuid> — when `run_id` is sent (pay-for-friend on a run),
 * the handler verifies that pickup run exists. Other callers may omit `run_id`.
 */
export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const token = bearer(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const sessionUserId = userData.user?.id;
    if (authErr || !sessionUserId) {
      return NextResponse.json(
        { error: authErr ? authErr.message : "Unauthorized" },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const runId = (url.searchParams.get("run_id") || "").trim();
    const limitParam = Number(url.searchParams.get("limit") || "5");
    const limit = Number.isFinite(limitParam) ? Math.min(5, Math.max(1, Math.floor(limitParam))) : 5;

    if (!q) {
      return NextResponse.json([]);
    }

    const needle = sanitizeIlike(q);
    if (!needle) {
      return NextResponse.json([]);
    }

    if (runId) {
      const { data: runRow, error: runErr } = await admin
        .from("pickup_runs")
        .select("id")
        .eq("id", runId)
        .maybeSingle();

      if (runErr) {
        return NextResponse.json(
          { error: runErr.message, details: runErr.details, hint: runErr.hint, code: runErr.code },
          { status: 500 },
        );
      }
      if (!runRow) {
        return NextResponse.json({ error: "Run not found." }, { status: 404 });
      }
    }

    // Match PostgREST `or` format used elsewhere (e.g. mobile/app/players.tsx): unquoted %pat%.
    const safe = needle.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const like = `%${safe}%`;

    const { data, error } = await admin
      .from("profiles")
      .select("id, first_name, last_name, username, nearest_venue")
      .eq("approved", true)
      .eq("is_banned", false)
      .neq("id", sessionUserId)
      .or(`first_name.ilike.${like},last_name.ilike.${like},username.ilike.${like}`)
      .order("first_name", { ascending: true })
      .limit(limit);

    if (error) {
      console.error(
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
      return NextResponse.json(
        {
          error: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
          code: error.code ?? null,
        },
        { status: 500 },
      );
    }

    const rows = data || [];
    const out = rows.map((row) => ({
      id: row.id as string,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      username: typeof row.username === "string" && row.username.length > 0 ? row.username : null,
      nearest_venue: typeof row.nearest_venue === "string" ? row.nearest_venue : null,
    }));

    return NextResponse.json(out);
  } catch (e) {
    const message = errMessage(e);
    console.error("[pickup/find-player] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
