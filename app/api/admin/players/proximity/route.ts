import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { createDriveMinutesCache } from "@/lib/pickup/profileMaxDriveFilter";
import { googleDriveMinutesFromZipsToDestination, resolveRunVenueDestination } from "@/lib/venueDistance";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const MIN_MAX_MINUTES = 15;
const MAX_MAX_MINUTES = 90;

function normalizeZip(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

function clampMaxMinutes(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 60;
  return Math.min(MAX_MAX_MINUTES, Math.max(MIN_MAX_MINUTES, Math.round(n)));
}

export type ProximityPlayerResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  zip_code: string;
  drive_minutes: number;
};

/** GET — approved players within `max_minutes` drive of a venue (Google Distance Matrix). */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  try {
    const url = new URL(req.url);
    const venue = String(url.searchParams.get("venue") || "").trim();
    const max_minutes = clampMaxMinutes(url.searchParams.get("max_minutes"));

    if (!venue) {
      return NextResponse.json({ error: "Missing venue" }, { status: 400 });
    }

    const dest = resolveRunVenueDestination({ locationPrivate: null, serviceRegion: null, venueName: venue });
    if (!dest) {
      return NextResponse.json(
        { error: "Unknown venue. Pick a CT Pickup venue name or paste a known venue label." },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();
    const profRes = await admin
      .from("profiles")
      .select("id,first_name,last_name,instagram,tier,tier_rank,zip_code")
      .eq("approved", true)
      .not("zip_code", "is", null)
      .order("first_name", { ascending: true });

    if (profRes.error) {
      return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    }

    const withZip: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      instagram: string | null;
      tier: string | null;
      tier_rank: number | null;
      zip_code: string;
      zip5: string;
    }[] = [];

    for (const row of profRes.data || []) {
      const zip5 = normalizeZip(row.zip_code);
      if (!zip5) continue;
      withZip.push({
        id: row.id as string,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        instagram: row.instagram ?? null,
        tier: row.tier ?? null,
        tier_rank: row.tier_rank != null ? Number(row.tier_rank) : null,
        zip_code: zip5,
        zip5,
      });
    }

    const cache = createDriveMinutesCache();
    const minutesByZip = await googleDriveMinutesFromZipsToDestination(
      withZip.map((p) => p.zip5),
      dest,
      cache,
    );

    const players: ProximityPlayerResult[] = [];
    for (const p of withZip) {
      const drive_minutes = minutesByZip.get(p.zip5);
      if (drive_minutes == null) continue;
      if (drive_minutes > max_minutes) continue;
      players.push({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        instagram: p.instagram,
        tier: p.tier,
        tier_rank: p.tier_rank,
        zip_code: p.zip_code,
        drive_minutes,
      });
    }

    players.sort((a, b) => a.drive_minutes - b.drive_minutes);

    return NextResponse.json({
      venue: dest.venue,
      max_minutes,
      count: players.length,
      players,
    });
  } catch (err: unknown) {
    Sentry.captureException(err);
    console.error("[admin/players/proximity GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
