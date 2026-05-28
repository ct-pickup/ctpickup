import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type RegionCode = "CT" | "NY" | "NJ" | "MD";

function normalizeZipDigits(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function regionFromZip(zipDigits: string | null): RegionCode | null {
  if (!zipDigits) return null;
  const prefix2 = zipDigits.slice(0, 2);
  const n = Number(prefix2);
  if (!Number.isFinite(n)) return null;

  // CT: 06xxx
  if (prefix2 === "06") return "CT";
  // NY: 10xxx–14xxx
  if (n >= 10 && n <= 14) return "NY";
  // NJ: 07xxx–08xxx
  if (n >= 7 && n <= 8) return "NJ";
  // MD: 20xxx–21xxx
  if (n >= 20 && n <= 21) return "MD";
  return null;
}

/** Strip ILIKE wildcards from user input so filters stay bounded and predictable. */
function sanitizeIlike(raw: string) {
  return raw.replace(/%/g, "").replace(/_/g, "").replace(/,/g, "");
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const token = bearer(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Auth is required (so we can safely return the approved player directory),
    // but admin status is NOT required.
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData.user?.id) {
      return NextResponse.json({ error: authErr ? authErr.message : "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const regionRaw = (url.searchParams.get("region") || "").trim().toUpperCase();
    const region = (["CT", "NY", "NJ", "MD"] as const).includes(regionRaw as RegionCode)
      ? (regionRaw as RegionCode)
      : null;

    const qRaw = (url.searchParams.get("q") || "").trim();
    const q = qRaw ? sanitizeIlike(qRaw) : "";

    const limitParam = Number(url.searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitParam) ? Math.min(500, Math.max(1, Math.floor(limitParam))) : 200;

    const offsetParam = Number(url.searchParams.get("offset") || "0");
    const offset = Number.isFinite(offsetParam) ? Math.max(0, Math.floor(offsetParam)) : 0;

    let query = admin
      .from("profiles")
      .select(
        "id,first_name,last_name,username,instagram,playing_position,tier,tier_rank,zip_code,attended_count,approved,is_banned",
      )
      .eq("approved", true)
      .eq("is_banned", false)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) {
      const safe = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const like = `%${safe}%`;
      query = query.or(`first_name.ilike.${like},last_name.ilike.${like},username.ilike.${like}`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: error.message, details: error.details ?? null, hint: error.hint ?? null, code: error.code ?? null },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const out = rows
      .map((row) => {
        const zip5 = normalizeZipDigits(row.zip_code);
        const derivedRegion = regionFromZip(zip5);
        return {
          id: String(row.id),
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          username: typeof row.username === "string" && row.username.trim() ? row.username.trim() : null,
          instagram: typeof row.instagram === "string" && row.instagram.trim() ? row.instagram.trim() : null,
          playing_position: typeof row.playing_position === "string" ? row.playing_position : null,
          tier: row.tier ?? null,
          tier_rank: typeof row.tier_rank === "number" ? row.tier_rank : row.tier_rank != null ? Number(row.tier_rank) : null,
          zip_code: zip5,
          region: derivedRegion, // null when zip missing/unknown
          attended_count:
            typeof row.attended_count === "number"
              ? row.attended_count
              : row.attended_count != null
                ? Number(row.attended_count)
                : null,
        };
      })
      .filter((p) => {
        // Region filter:
        // - If a region is selected, include players whose zip-derived region matches.
        // - If player has no zip (region null), still include them (but with no region tag).
        if (!region) return true;
        if (p.region == null) return true;
        return p.region === region;
      });

    return NextResponse.json({ players: out });
  } catch (e) {
    const message = errMessage(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

