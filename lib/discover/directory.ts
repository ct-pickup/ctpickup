import type { SupabaseClient } from "@supabase/supabase-js";

import { internalStar, positionGroup, positionLabel } from "@/lib/match/compatibility";
import { lastInitial, townFromZip } from "@/lib/match/compatibilityData";
import { destinationFromVenueZipCode, estimateDriveMinutesFromZip } from "@/lib/venueDistance";
import {
  DIRECTORY_DRIVE_CHOICES,
  DIRECTORY_MAX_OFFSET,
  DIRECTORY_PAGE_SIZE,
  displayName,
  DRIVE_BUCKETS,
  type DirectoryPlayer,
  type DriveBucket,
  type DirectoryResponse,
} from "@/shared/discover";
import { starLevelName } from "@/shared/starLevels";
import { DiscoverError, loadCandidates, loadViewer, positions, type CandidateRow } from "@/lib/discover/discoverService";


export type DirectoryQuery = {
  /** A position label as shown on cards ("CB", "Midfielder"), or null for any. */
  position: string | null;
  minStar: number | null;
  maxStar: number | null;
  /** Largest drive time in minutes, or null for any. */
  maxDriveMinutes: number | null;
  offset: number;
};

export type DirectoryQueryParse = { ok: true; query: DirectoryQuery } | { ok: false; error: string };

const HALF_STARS = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);

/** Absent means no bound; anything present must be a half star from 0.5 to 5.0. */
function parseHalfStar(raw: string | null): { ok: true; value: number | null } | { ok: false } {
  if (raw == null || raw.trim() === "") return { ok: true, value: null };
  const n = Number(raw);
  return Number.isFinite(n) && HALF_STARS.includes(n) ? { ok: true, value: n } : { ok: false };
}

/** Reads and validates the query string. Anything out of range is an error, never a silent default. */
export function parseDirectoryQuery(params: URLSearchParams): DirectoryQueryParse {
  const position = (params.get("position") ?? "").trim() || null;
  if (position && position.length > 24) return { ok: false, error: "Unknown position." };

  const min = parseHalfStar(params.get("min_star"));
  const max = parseHalfStar(params.get("max_star"));
  if (!min.ok || !max.ok) return { ok: false, error: "Levels must be half stars from 0.5 to 5.0." };
  if (min.value != null && max.value != null && min.value > max.value) return { ok: false, error: "The lowest level cannot be above the highest." };

  let maxDriveMinutes: number | null = null;
  const driveRaw = params.get("max_drive");
  if (driveRaw != null && driveRaw !== "") {
    const n = Number(driveRaw);
    if (!(DIRECTORY_DRIVE_CHOICES as readonly number[]).includes(n)) {
      return { ok: false, error: `max_drive must be ${DIRECTORY_DRIVE_CHOICES.join(", ")} or left out.` };
    }
    maxDriveMinutes = n;
  }

  const cursorRaw = params.get("cursor");
  let offset = 0;
  if (cursorRaw != null && cursorRaw !== "") {
    offset = Number(cursorRaw);
    if (!Number.isInteger(offset) || offset < 0 || offset > DIRECTORY_MAX_OFFSET) return { ok: false, error: "Invalid cursor." };
  }
  return { ok: true, query: { position, minStar: min.value, maxStar: max.value, maxDriveMinutes, offset } };
}

/** The range an exact drive time falls in: under 15, 15 up to 30, 30 up to 45, 45 or more. Null when unknown. */
export function driveBucketFor(minutes: number | null | undefined): DriveBucket | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 15) return "under_15";
  if (minutes < 30) return "15_30";
  if (minutes < 45) return "30_45";
  return "45_plus";
}

const BUCKET_RANK = new Map<DriveBucket | null, number>([...DRIVE_BUCKETS.map((b, i) => [b, i] as const), [null, DRIVE_BUCKETS.length]]);

/** A candidate with everything the filters and the sort need. Never leaves the server as is. */
export type DirectoryEntry = {
  player: DirectoryPlayer;
  /** Exact, for the distance filter only. Never serialized and never used to order results. */
  drive: number | null;
};

function matchesPosition(label: string | null, wanted: string | null): boolean {
  if (!wanted) return true;
  const w = wanted.trim().toLowerCase();
  if (label?.toLowerCase() === w) return true;
  // A broad choice such as "Midfielder" also matches every midfield code.
  const group = positionGroup(wanted);
  return group != null && (positionGroup(label) === group) && !/^[A-Za-z]{2,3}$/.test(wanted.trim());
}

/** Filters, orders (nearest first, then name, then id) and slices one page. Pure. */
export function pageDirectory(entries: readonly DirectoryEntry[], q: DirectoryQuery, pageSize: number = DIRECTORY_PAGE_SIZE): DirectoryResponse {
  const kept = entries.filter(({ player, drive }) => {
    if (!matchesPosition(player.position, q.position)) return false;
    if (q.minStar != null && (player.star == null || player.star < q.minStar)) return false;
    if (q.maxStar != null && (player.star == null || player.star > q.maxStar)) return false;
    if (q.maxDriveMinutes != null && (drive == null || drive > q.maxDriveMinutes)) return false;
    return true;
  });
  // Closest range first, then name. Ordering inside a range is by name so it carries no distance information.
  kept.sort(
    (a, b) =>
      (BUCKET_RANK.get(a.player.driveBucket) ?? 0) - (BUCKET_RANK.get(b.player.driveBucket) ?? 0) ||
      a.player.name.localeCompare(b.player.name) ||
      a.player.id.localeCompare(b.player.id),
  );
  const slice = kept.slice(q.offset, q.offset + pageSize);
  const next = q.offset + pageSize;
  return {
    players: slice.map((e) => e.player),
    nextCursor: next < kept.length && next <= DIRECTORY_MAX_OFFSET ? String(next) : null,
  };
}

const CHUNK = 200;

async function starsFor(admin: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let res = await admin.from("player_ratings").select("user_id,tier,star_rating").in("user_id", slice);
    if (res.error) res = (await admin.from("player_ratings").select("user_id,tier").in("user_id", slice)) as typeof res;
    for (const row of res.data ?? []) {
      const r = row as { user_id: string; tier: string | null; star_rating?: number | string | null };
      const s = internalStar(r);
      if (s != null) out.set(r.user_id, s);
    }
  }
  return out;
}

function toEntry(row: CandidateRow, viewerZip: string | null | undefined, star: number | null): DirectoryEntry {
  const dest = destinationFromVenueZipCode(row.zip_code);
  const drive = dest ? estimateDriveMinutesFromZip(viewerZip, dest.lat, dest.lng) : null;
  return {
    drive,
    player: {
      id: row.id,
      name: displayName(row.first_name, lastInitial(row.last_name)),
      avatarUrl: String(row.avatar_url ?? ""),
      star,
      levelName: starLevelName(star),
      position: positionLabel(positions(row).primary),
      town: townFromZip(row.zip_code),
      driveBucket: driveBucketFor(drive),
    },
  };
}

/**
 * One page of the directory. The people are exactly Discover's candidates: approved, not banned, with a photo, not
 * hidden by "allow host invites", and never anyone blocked either way or reported by the viewer. The fields are the
 * Discover card fields (name as "Sam R.", photo, level, position, town) plus a drive-time range (never the exact minutes). No email, phone,
 * Instagram handle, ZIP, rating score or reliability ever leaves the server.
 */
export async function directoryPage(admin: SupabaseClient, viewerId: string, q: DirectoryQuery): Promise<DirectoryResponse> {
  const viewer = await loadViewer(admin, viewerId).catch(() => {
    throw new DiscoverError("We could not load your profile.", 500);
  });
  const candidates = await loadCandidates(admin, viewerId);
  const stars = await starsFor(admin, candidates.map((c) => c.id));
  const entries = candidates.map((c) => toEntry(c, viewer.zip_code, stars.get(c.id) ?? null));
  return pageDirectory(entries, q);
}
