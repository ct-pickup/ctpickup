import type { SupabaseClient } from "@supabase/supabase-js";

import { distanceFit, internalStar, levelFit, positionGroup, positionLabel } from "@/lib/match/compatibility";
import { allowsHostInvites, lastInitial, loadPlayHistory, townFromZip, type MatchProfile } from "@/lib/match/compatibilityData";
import { destinationFromVenueZipCode, estimateDriveMinutesFromZip } from "@/lib/venueDistance";
import {
  DISCOVER_PICK_COUNT,
  discoverReasons,
  discoverScore,
  displayName,
  mutualsFit,
  normalizeFullName,
  normalizeHandle,
  SEARCH_HITS_PER_HOUR,
  SEARCH_MAX_RESULTS,
  weekStartET,
  type DiscoverComponent,
  type DiscoverPlayer,
} from "@/shared/discover";
import { starLevelName } from "@/shared/starLevels";

/** How many top-ranked candidates get the (more expensive) mutual-teammate pass. */
const SHORTLIST = 40;

/** No response carries more than this many players. */
const MAX_DISCOVER_RESULTS = 20;

/** Default max drive time when the viewer has not set one. */
const DEFAULT_MAX_DRIVE_MINUTES = 30;

export class DiscoverError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DiscoverError";
    this.status = status;
  }
}

type CandidateRow = MatchProfile & {
  username?: string | null;
  is_banned?: boolean | null;
};

const CANDIDATE_COLUMNS =
  "id,first_name,last_name,username,avatar_url,zip_code,max_drive_minutes,approved,is_banned,playing_position,primary_position,secondary_positions,allow_host_invites";

/** Everyone the viewer must never see: themselves, blocks either way, anyone they reported. */
async function excludedIds(admin: SupabaseClient, viewerId: string): Promise<Set<string>> {
  const out = new Set<string>([viewerId]);

  const [blocks, chatReports, photoReports] = await Promise.all([
    admin.from("chat_blocks").select("blocker_user_id,blocked_user_id").or(
      `blocker_user_id.eq.${viewerId},blocked_user_id.eq.${viewerId}`,
    ),
    admin.from("chat_reports").select("reported_user_id").eq("reporter_user_id", viewerId),
    admin.from("photo_reports").select("reported_user_id").eq("reporter_id", viewerId),
  ]);

  for (const row of blocks.data ?? []) {
    const r = row as { blocker_user_id: string; blocked_user_id: string };
    out.add(r.blocker_user_id === viewerId ? r.blocked_user_id : r.blocker_user_id);
  }
  for (const row of chatReports.data ?? []) out.add(String((row as { reported_user_id: string }).reported_user_id));
  for (const row of photoReports.data ?? []) out.add(String((row as { reported_user_id: string }).reported_user_id));

  return out;
}

function positions(p: CandidateRow): { primary: string | null; secondary: string[] } {
  const primary = (p.primary_position ?? p.playing_position ?? null) || null;
  const secondary = Array.isArray(p.secondary_positions) ? p.secondary_positions.filter(Boolean) : [];
  return { primary, secondary };
}

/**
 * 1 when the primary positions match, 0.6 when they share a group, else 0.2. Only a
 * 1 is offered as a reason, so the "Also a CB" chip always means the same position.
 */
function positionFit(mine: string | null, theirs: string | null): number {
  if (!mine || !theirs) return 0.2;
  if (mine.trim().toUpperCase() === theirs.trim().toUpperCase()) return 1;
  const a = positionGroup(mine);
  const b = positionGroup(theirs);
  return a && b && a === b ? 0.6 : 0.2;
}

async function loadViewer(admin: SupabaseClient, viewerId: string): Promise<CandidateRow> {
  const res = await admin.from("profiles").select(CANDIDATE_COLUMNS).eq("id", viewerId).maybeSingle();
  if (res.error || !res.data) throw new DiscoverError("We could not load your profile.", 500);
  return res.data as CandidateRow;
}

async function loadStarsFor(admin: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const res = await admin.from("player_ratings").select("user_id,tier,star_rating").in("user_id", ids);
  for (const row of res.data ?? []) {
    const r = row as { user_id: string; tier: string | null; star_rating?: number | string | null };
    const s = internalStar(r);
    if (s != null) out.set(r.user_id, s);
  }
  return out;
}

/** The safe payload. Everything not listed here stays on the server. */
function toDiscoverPlayer(
  row: CandidateRow,
  star: number | null,
  reasons: string[],
): DiscoverPlayer {
  const { primary } = positions(row);
  return {
    id: row.id,
    name: displayName(row.first_name, lastInitial(row.last_name)),
    avatarUrl: String(row.avatar_url ?? ""),
    star: star ?? null,
    levelName: starLevelName(star),
    position: positionLabel(primary),
    town: townFromZip(row.zip_code),
    reasons,
  };
}

/**
 * Candidates the viewer is allowed to be shown: approved, not banned, has a photo,
 * invitable, and not excluded. Returns rows only; ranking happens separately.
 */
async function loadCandidates(admin: SupabaseClient, viewerId: string): Promise<CandidateRow[]> {
  const excluded = await excludedIds(admin, viewerId);

  const res = await admin
    .from("profiles")
    .select(CANDIDATE_COLUMNS)
    .eq("approved", true)
    .eq("is_banned", false)
    .not("avatar_url", "is", null);

  if (res.error) throw new DiscoverError("We could not load players right now.", 500);

  return (res.data ?? [])
    .map((r) => r as CandidateRow)
    .filter((r) => !excluded.has(r.id))
    .filter((r) => String(r.avatar_url ?? "").trim().length > 0)
    .filter((r) => allowsHostInvites(r));
}

/** Ranks candidates for the viewer and returns the top `count` as ids. */
async function rankCandidates(
  admin: SupabaseClient,
  viewer: CandidateRow,
  candidates: CandidateRow[],
  count: number,
): Promise<string[]> {
  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.id);
  const stars = await loadStarsFor(admin, [viewer.id, ...ids]);
  const myStar = stars.get(viewer.id) ?? null;
  const mine = positions(viewer);
  const maxDrive = viewer.max_drive_minutes && viewer.max_drive_minutes > 0 ? viewer.max_drive_minutes : DEFAULT_MAX_DRIVE_MINUTES;

  const partial = candidates.map((c) => {
    const theirStar = stars.get(c.id) ?? null;
    const dest = destinationFromVenueZipCode(c.zip_code);
    const driveMinutes = dest ? estimateDriveMinutesFromZip(viewer.zip_code, dest.lat, dest.lng) : null;
    const components: Record<DiscoverComponent, number> = {
      level: levelFit(myStar, theirStar),
      position: positionFit(mine.primary, positions(c).primary),
      distance: distanceFit(driveMinutes, maxDrive),
      mutuals: 0,
    };
    return { row: c, star: theirStar, driveMinutes, components };
  });

  // Only players reachable inside the viewer's max drive time are eligible.
  const reachable = partial.filter((p) => p.driveMinutes != null && p.driveMinutes <= maxDrive);
  const pool = reachable.length ? reachable : partial;

  pool.sort((a, b) => discoverScore(b.components) - discoverScore(a.components));
  const shortlist = pool.slice(0, SHORTLIST);

  const history = await loadPlayHistory(admin, [viewer.id, ...shortlist.map((s) => s.row.id)]);
  const myTeammates = history.byUser.get(viewer.id)?.playedWith ?? new Set<string>();

  const scored = shortlist.map((s) => {
    const theirs = history.byUser.get(s.row.id)?.playedWith ?? new Set<string>();
    let mutual = 0;
    for (const id of theirs) if (id !== viewer.id && myTeammates.has(id)) mutual += 1;
    const components = { ...s.components, mutuals: mutualsFit(mutual) };
    return { ...s, mutual, components, score: discoverScore(components) };
  });

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  return scored.slice(0, count).map((s) => s.row.id);
}

/** Builds the payload for an already-chosen set of ids, preserving their order. */
async function hydrate(admin: SupabaseClient, viewer: CandidateRow, ids: string[]): Promise<DiscoverPlayer[]> {
  if (!ids.length) return [];

  const res = await admin.from("profiles").select(CANDIDATE_COLUMNS).in("id", ids);
  if (res.error) throw new DiscoverError("We could not load your picks right now.", 500);

  const byId = new Map<string, CandidateRow>();
  for (const row of res.data ?? []) {
    const r = row as CandidateRow;
    // A player who turned invites off, lost their photo or was banned since Monday drops out.
    if (r.approved === true && r.is_banned !== true && String(r.avatar_url ?? "").trim() && allowsHostInvites(r)) {
      byId.set(r.id, r);
    }
  }

  const present = ids
    .map((id) => byId.get(id))
    .filter((r): r is CandidateRow => r != null)
    .slice(0, MAX_DISCOVER_RESULTS);
  if (!present.length) return [];

  const stars = await loadStarsFor(admin, [viewer.id, ...present.map((p) => p.id)]);
  const myStar = stars.get(viewer.id) ?? null;
  const mine = positions(viewer);
  const maxDrive = viewer.max_drive_minutes && viewer.max_drive_minutes > 0 ? viewer.max_drive_minutes : DEFAULT_MAX_DRIVE_MINUTES;

  const history = await loadPlayHistory(admin, [viewer.id, ...present.map((p) => p.id)]);
  const myTeammates = history.byUser.get(viewer.id)?.playedWith ?? new Set<string>();

  return present.map((row) => {
    const theirStar = stars.get(row.id) ?? null;
    const dest = destinationFromVenueZipCode(row.zip_code);
    const driveMinutes = dest ? estimateDriveMinutesFromZip(viewer.zip_code, dest.lat, dest.lng) : null;
    const theirs = history.byUser.get(row.id)?.playedWith ?? new Set<string>();
    let mutual = 0;
    for (const id of theirs) if (id !== viewer.id && myTeammates.has(id)) mutual += 1;
    const myTown = townFromZip(viewer.zip_code);
    const theirTown = townFromZip(row.zip_code);

    const theirPrimary = positions(row).primary;
    const reasons = discoverReasons({
      level: levelFit(myStar, theirStar),
      position: positionFit(mine.primary, theirPrimary),
      distance: distanceFit(driveMinutes, maxDrive),
      mutuals: mutualsFit(mutual),
      positionLabel: positionLabel(theirPrimary),
      driveMinutes,
      mutualCount: mutual,
      playedTogether: history.byUser.get(viewer.id)?.timesWith?.get(row.id) ?? 0,
      sameTown: myTown != null && myTown === theirTown,
    });

    return toDiscoverPlayer(row, theirStar, reasons);
  });
}

/**
 * The viewer's picks for the current Eastern week. Chosen once on first read of the
 * week and cached, so the same five show all week.
 */
export async function weeklyPicks(
  admin: SupabaseClient,
  viewerId: string,
  now: Date = new Date(),
): Promise<{ weekStart: string; players: DiscoverPlayer[] }> {
  const weekStart = weekStartET(now);
  const viewer = await loadViewer(admin, viewerId);

  const cached = await admin
    .from("discover_weekly_picks")
    .select("player_ids")
    .eq("user_id", viewerId)
    .eq("week_start", weekStart)
    .maybeSingle();

  const cachedIds = (cached.data as { player_ids?: string[] } | null)?.player_ids;
  if (Array.isArray(cachedIds) && cachedIds.length) {
    return { weekStart, players: await hydrate(admin, viewer, cachedIds) };
  }

  const candidates = await loadCandidates(admin, viewerId);
  const picked = await rankCandidates(admin, viewer, candidates, DISCOVER_PICK_COUNT);

  if (picked.length) {
    // Another request this week may have written first; keep whatever landed.
    await admin
      .from("discover_weekly_picks")
      .upsert({ user_id: viewerId, week_start: weekStart, player_ids: picked }, { onConflict: "user_id,week_start" });
  }

  return { weekStart, players: await hydrate(admin, viewer, picked) };
}

/** Throws when the viewer is over the hourly search allowance. */
export async function checkSearchRate(admin: SupabaseClient, viewerId: string, now: Date = new Date()): Promise<void> {
  const hourStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();

  const current = await admin
    .from("discover_search_usage")
    .select("hits")
    .eq("user_id", viewerId)
    .eq("hour_start", hourStart)
    .maybeSingle();

  const hits = Number((current.data as { hits?: number } | null)?.hits ?? 0);
  if (hits >= SEARCH_HITS_PER_HOUR) {
    throw new DiscoverError("You have searched a lot in the last hour. Try again later.", 429);
  }

  await admin
    .from("discover_search_usage")
    .upsert({ user_id: viewerId, hour_start: hourStart, hits: hits + 1 }, { onConflict: "user_id,hour_start" });
}

/**
 * Exact full-name or exact @username match only. A partial query returns nothing,
 * so this can never be walked to enumerate players.
 */
export async function searchPlayers(admin: SupabaseClient, viewerId: string, rawQuery: string): Promise<DiscoverPlayer[]> {
  const query = String(rawQuery ?? "").trim();
  if (!query) return [];

  const viewer = await loadViewer(admin, viewerId);
  const candidates = await loadCandidates(admin, viewerId);

  const handle = normalizeHandle(query);
  const full = normalizeFullName(query);

  const matches = candidates.filter((c) => {
    if (handle && normalizeHandle(c.username) === handle) return true;
    const name = normalizeFullName(`${c.first_name ?? ""} ${c.last_name ?? ""}`);
    return full.length > 0 && name === full;
  });

  return hydrate(admin, viewer, matches.slice(0, SEARCH_MAX_RESULTS).map((m) => m.id));
}
