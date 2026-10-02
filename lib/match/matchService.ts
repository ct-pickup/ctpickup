import type { SupabaseClient } from "@supabase/supabase-js";
import { gameLevel, positionLabel, scoreCompatibility, type ScoringGame } from "@/lib/match/compatibility";
import {
  allowsHostInvites,
  driveMinutesToRun,
  INACTIVE_RSVP_STATUSES,
  lastInitial,
  loadConfirmedAttendees,
  loadMatchProfiles,
  loadPlayHistory,
  loadStars,
  looksLikeMissingRelation,
  playerPositions,
  selectWithOptionalColumns,
  townFromZip,
  type MatchProfile,
  type PlayHistory,
} from "@/lib/match/compatibilityData";
import { createInviteToken, readInviteToken } from "@/lib/match/inviteToken";
import { deliverRunInvite } from "@/lib/pickup/deliverRunInvite";
import { effectiveMaxDriveMinutes } from "@/lib/pickup/profileMaxDriveFilter";
import { PICKUP_CAPACITY_STATUSES } from "@/lib/pickup/waitlist";

export const MATCH_CONFIG = {
  bestGamesDays: 7,
  bestGamesDefault: 3,
  bestGamesMax: 10,
  bestGamesScanLimit: 60,
  playedWithMaxRuns: 40,
  playedWithPeopleShown: 3,
  candidatesMax: 10,
  candidatePoolScanLimit: 3000,
  candidatePoolCap: 150,
  /** Below-average allowance when the game has no min_star. */
  levelSlackBelowAverage: 0.5,
  invitesPerGame: 20,
  listRateLimit: { limit: 30, windowSeconds: 60 * 60 },
} as const;

export const HOST_INVITES_TABLE = "pickup_run_host_invites";

export const OPEN_RUN_STATUSES = new Set(["planning", "likely_on", "active"]);

type DbError = { message: string; code?: string } | null;

export class MatchError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function fail(label: string, error: DbError): never {
  console.error(`[match] ${label}:`, error?.message);
  throw new MatchError(500, `Could not load ${label}.`);
}

export type MatchRun = {
  id: string;
  title: string | null;
  start_at: string;
  status: string | null;
  run_type: string | null;
  capacity: number | null;
  spots_taken: number | null;
  fee_cents: number | null;
  format: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  location_private?: string | null;
  venue_zip_code?: string | null;
  service_region?: string | null;
  min_star?: number | string | null;
};

const RUN_BASE = [
  "id",
  "title",
  "start_at",
  "status",
  "run_type",
  "capacity",
  "spots_taken",
  "fee_cents",
  "format",
  "location_text",
  "latitude",
  "longitude",
  "created_by",
  "location_private",
  "venue_zip_code",
  "service_region",
];
const RUN_OPTIONAL = ["min_star"];

function minStarOf(run: MatchRun): number | null {
  const n = run.min_star == null ? NaN : Number(run.min_star);
  return Number.isFinite(n) ? n : null;
}

/** Fields of a run that are safe to show on a game card. */
export function runCard(run: MatchRun) {
  return {
    id: run.id,
    title: run.title,
    start_at: run.start_at,
    location_text: run.location_text,
    latitude: run.latitude,
    longitude: run.longitude,
    capacity: run.capacity ?? 0,
    spots_taken: run.spots_taken ?? 0,
    fee_cents: run.fee_cents ?? 0,
    format: run.format,
    run_type: run.run_type,
    status: run.status,
  };
}

export type PlayedWithSummary = { count: number; people: { first_name: string | null; avatar_url: string | null }[] };

function playedWithSummary(ids: string[], profiles: Map<string, MatchProfile>): PlayedWithSummary {
  return {
    count: ids.length,
    people: ids.slice(0, MATCH_CONFIG.playedWithPeopleShown).map((id) => {
      const p = profiles.get(id);
      return { first_name: p?.first_name?.trim() || null, avatar_url: p?.avatar_url?.trim() || null };
    }),
  };
}

function scoringGame(run: MatchRun, attendeeIds: string[], stars: Map<string, number>, profiles: Map<string, MatchProfile>): ScoringGame {
  return {
    startAt: run.start_at,
    format: run.format,
    capacity: run.capacity,
    minStar: minStarOf(run),
    attendeeIds,
    attendeeStars: attendeeIds.map((id) => stars.get(id) ?? null),
    attendeePositions: attendeeIds.map((id) => playerPositions(profiles.get(id)).primary),
  };
}

const EMPTY_HISTORY: PlayHistory = { playedWith: new Set(), pastStarts: [] };

/* ------------------------------------------------------------ best games */

export async function bestGamesForUser(admin: SupabaseClient, userId: string, limit: number) {
  const now = Date.now();
  const [profileRes, starRes, historyRes] = await Promise.all([
    loadMatchProfiles(admin, [userId]),
    loadStars(admin, [userId]),
    loadPlayHistory(admin, [userId]),
  ]);
  if (profileRes.error) fail("profile", profileRes.error);
  if (starRes.error) fail("rating", starRes.error);
  if (historyRes.error) fail("play history", historyRes.error);
  const me = profileRes.byId.get(userId) ?? null;
  const myHistory = historyRes.byUser.get(userId) ?? EMPTY_HISTORY;
  const maxDrive = effectiveMaxDriveMinutes(me?.max_drive_minutes ?? null);

  const runsRes = await selectWithOptionalColumns<MatchRun>(
    (cols) =>
      admin
        .from("pickup_runs")
        .select(cols)
        .in("status", Array.from(OPEN_RUN_STATUSES))
        .gte("start_at", new Date(now).toISOString())
        .lte("start_at", new Date(now + MATCH_CONFIG.bestGamesDays * 86400000).toISOString())
        .order("start_at", { ascending: true })
        .limit(MATCH_CONFIG.bestGamesScanLimit),
    RUN_BASE,
    RUN_OPTIONAL,
  );
  if (runsRes.error) fail("games", runsRes.error);

  let runs = runsRes.data.filter(
    (r) => r.run_type !== "select" && r.created_by !== userId && (r.capacity ?? 0) - (r.spots_taken ?? 0) > 0,
  );
  if (!runs.length) return [];

  const myRsvps = await admin
    .from("pickup_run_rsvps")
    .select("run_id,status")
    .eq("user_id", userId)
    .in("run_id", runs.map((r) => r.id));
  if (myRsvps.error) fail("your RSVPs", myRsvps.error);
  const taken = new Set(
    ((myRsvps.data ?? []) as { run_id: string; status: string | null }[])
      .filter((r) => !INACTIVE_RSVP_STATUSES.has(String(r.status ?? "").toLowerCase()))
      .map((r) => r.run_id),
  );

  const drive = new Map<string, number | null>();
  runs = runs.filter((r) => {
    if (taken.has(r.id)) return false;
    const minutes = driveMinutesToRun(me?.zip_code, r);
    drive.set(r.id, minutes);
    return minutes == null || maxDrive >= 90 || minutes <= maxDrive;
  });
  if (!runs.length) return [];

  const attendees = await loadConfirmedAttendees(admin, runs.map((r) => r.id));
  if (attendees.error) fail("attendees", attendees.error);
  const attendeeIds = Array.from(new Set(Array.from(attendees.byRun.values()).flat()));
  const [attendeeProfiles, attendeeStars] = await Promise.all([loadMatchProfiles(admin, attendeeIds), loadStars(admin, attendeeIds)]);
  if (attendeeProfiles.error) fail("attendee profiles", attendeeProfiles.error);
  if (attendeeStars.error) fail("attendee ratings", attendeeStars.error);

  const pos = playerPositions(me);
  const scored = runs.map((run) => {
    const ids = (attendees.byRun.get(run.id) ?? []).filter((id) => id !== userId);
    const result = scoreCompatibility(
      { star: starRes.internal.get(userId) ?? null, primaryPosition: pos.primary, secondaryPositions: pos.secondary, maxDriveMinutes: maxDrive },
      scoringGame(run, ids, attendeeStars.internal, attendeeProfiles.byId),
      { driveMinutes: drive.get(run.id) ?? null, playedWithIds: myHistory.playedWith, pastGameStarts: myHistory.pastStarts },
    );
    return { run, result };
  });

  scored.sort((a, b) => b.result.score - a.result.score || a.run.start_at.localeCompare(b.run.start_at));
  return scored.slice(0, limit).map(({ run, result }) => ({
    ...runCard(run),
    reasons: result.reasons,
    played_with: playedWithSummary(result.playedWithAttendeeIds, attendeeProfiles.byId),
  }));
}

/* ------------------------------------------------------------ played with */

export async function playedWithForRuns(admin: SupabaseClient, userId: string, runIds: string[]) {
  const ids = Array.from(new Set(runIds.filter(Boolean))).slice(0, MATCH_CONFIG.playedWithMaxRuns);
  const out: Record<string, PlayedWithSummary> = {};
  if (!ids.length) return out;
  const [historyRes, attendees] = await Promise.all([loadPlayHistory(admin, [userId]), loadConfirmedAttendees(admin, ids)]);
  if (historyRes.error) fail("play history", historyRes.error);
  if (attendees.error) fail("attendees", attendees.error);
  const playedWith = historyRes.byUser.get(userId)?.playedWith ?? new Set<string>();

  const going = new Map<string, string[]>();
  for (const runId of ids) {
    const list = (attendees.byRun.get(runId) ?? []).filter((id) => id !== userId && playedWith.has(id));
    if (list.length) going.set(runId, list);
  }
  if (!going.size) return out;
  const profiles = await loadMatchProfiles(admin, Array.from(new Set(Array.from(going.values()).flat())));
  if (profiles.error) fail("profiles", profiles.error);
  for (const [runId, list] of going) out[runId] = playedWithSummary(list, profiles.byId);
  return out;
}

/* ------------------------------------------------------------ host access */

export type HostRunAccess = { run: MatchRun; isAdmin: boolean; reserved: number };

/**
 * Caller must host the run (or be an admin), have hosted at least one completed
 * run (admins exempt), and the run must be upcoming, open and not full.
 */
export async function requireHostRunAccess(admin: SupabaseClient, runId: string, callerId: string): Promise<HostRunAccess> {
  const runRes = await selectWithOptionalColumns<MatchRun>(
    (cols) => admin.from("pickup_runs").select(cols).eq("id", runId).limit(1),
    RUN_BASE,
    RUN_OPTIONAL,
  );
  if (runRes.error) fail("game", runRes.error);
  const run = runRes.data[0];
  if (!run) throw new MatchError(404, "Game not found.");

  const prof = await admin.from("profiles").select("is_admin").eq("id", callerId).maybeSingle();
  if (prof.error) fail("profile", prof.error);
  const isAdmin = (prof.data as { is_admin?: boolean | null } | null)?.is_admin === true;

  if (run.created_by !== callerId && !isAdmin) {
    throw new MatchError(403, "Only the host of this game can do that.");
  }

  if (!isAdmin) {
    const hosted = await admin
      .from("pickup_runs")
      .select("id")
      .eq("created_by", callerId)
      .eq("status", "completed")
      .limit(1);
    if (hosted.error) fail("hosting history", hosted.error);
    if (!((hosted.data as unknown[] | null) ?? []).length) {
      throw new MatchError(403, "Fill your game unlocks after you host your first completed game.");
    }
  }

  const status = String(run.status ?? "").trim().toLowerCase();
  if (!OPEN_RUN_STATUSES.has(status)) {
    throw new MatchError(409, status === "canceled" || status === "cancelled" ? "This game was canceled." : "This game is no longer open.");
  }
  const start = Date.parse(run.start_at);
  if (!Number.isFinite(start) || start <= Date.now()) {
    throw new MatchError(409, "This game has already started.");
  }

  const reservedRes = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", runId)
    .in("status", [...PICKUP_CAPACITY_STATUSES]);
  if (reservedRes.error) fail("RSVPs", reservedRes.error);
  const reserved = ((reservedRes.data as unknown[] | null) ?? []).length;
  const capacity = run.capacity ?? 0;
  if (capacity <= 0 || Math.max(run.spots_taken ?? 0, reserved) >= capacity) {
    throw new MatchError(409, "This game is full.");
  }

  return { run, isAdmin, reserved };
}

/* ------------------------------------------------------------ host invites */

async function hostInviteState(admin: SupabaseClient, runId: string) {
  const res = await admin.from(HOST_INVITES_TABLE).select("invitee_id").eq("run_id", runId);
  if (res.error) {
    if (looksLikeMissingRelation(res.error, HOST_INVITES_TABLE)) return { available: false as const, invited: new Set<string>() };
    fail("invites", res.error);
  }
  const invited = new Set(((res.data ?? []) as { invitee_id: string }[]).map((r) => r.invitee_id));
  return { available: true as const, invited };
}

/** Users with an RSVP row for the run other than a cancellation (going, waitlisted, pending, declined...). */
async function rsvpBlockedUserIds(admin: SupabaseClient, runId: string): Promise<Set<string>> {
  const res = await admin.from("pickup_run_rsvps").select("user_id,status").eq("run_id", runId);
  if (res.error) fail("RSVPs", res.error);
  return new Set(
    ((res.data ?? []) as { user_id: string; status: string | null }[])
      .filter((r) => !INACTIVE_RSVP_STATUSES.has(String(r.status ?? "").toLowerCase()))
      .map((r) => r.user_id),
  );
}

export type FillCandidate = {
  invite_token: string;
  first_name: string;
  last_initial: string | null;
  stars: number | null;
  position: string | null;
  town: string | null;
  invited: boolean;
};

export async function fillCandidatesForRun(admin: SupabaseClient, access: HostRunAccess) {
  const { run } = access;
  const hostId = run.created_by;

  const [attendees, blocked, inviteState] = await Promise.all([
    loadConfirmedAttendees(admin, [run.id]),
    rsvpBlockedUserIds(admin, run.id),
    hostInviteState(admin, run.id),
  ]);
  if (attendees.error) fail("attendees", attendees.error);
  const attendeeIds = attendees.byRun.get(run.id) ?? [];

  const pool = await admin
    .from("profiles")
    .select("id,zip_code,max_drive_minutes")
    .eq("approved", true)
    .not("zip_code", "is", null)
    .limit(MATCH_CONFIG.candidatePoolScanLimit);
  if (pool.error) fail("players", pool.error);

  const drive = new Map<string, number>();
  const nearby = ((pool.data ?? []) as { id: string; zip_code: string | null; max_drive_minutes: number | null }[])
    .filter((p) => p.id !== hostId && !blocked.has(p.id))
    .flatMap((p) => {
      const minutes = driveMinutesToRun(p.zip_code, run);
      if (minutes == null) return [];
      const max = effectiveMaxDriveMinutes(p.max_drive_minutes);
      if (max < 90 && minutes > max) return [];
      drive.set(p.id, minutes);
      return [p.id];
    })
    .sort((a, b) => drive.get(a)! - drive.get(b)!)
    .slice(0, MATCH_CONFIG.candidatePoolCap);

  const everyone = Array.from(new Set([...nearby, ...attendeeIds]));
  const [profiles, stars, history] = await Promise.all([
    loadMatchProfiles(admin, everyone),
    loadStars(admin, everyone),
    loadPlayHistory(admin, nearby),
  ]);
  if (profiles.error) fail("player profiles", profiles.error);
  if (stars.error) fail("ratings", stars.error);
  if (history.error) fail("play history", history.error);

  const game = scoringGame(run, attendeeIds, stars.internal, profiles.byId);
  const minStar = minStarOf(run);
  const avg = gameLevel(game.attendeeStars, null);
  const floor = minStar ?? (avg != null ? avg - MATCH_CONFIG.levelSlackBelowAverage : null);

  const ranked = nearby
    .flatMap((id) => {
      const p = profiles.byId.get(id);
      if (!p || p.approved !== true || !allowsHostInvites(p)) return [];
      const star = stars.internal.get(id) ?? null;
      if (floor != null && (star == null || star < floor)) return [];
      const pos = playerPositions(p);
      const h = history.byUser.get(id) ?? EMPTY_HISTORY;
      const result = scoreCompatibility(
        { star, primaryPosition: pos.primary, secondaryPositions: pos.secondary, maxDriveMinutes: effectiveMaxDriveMinutes(p.max_drive_minutes) },
        game,
        { driveMinutes: drive.get(id) ?? null, playedWithIds: h.playedWith, pastGameStarts: h.pastStarts },
      );
      return [{ p, pos, score: result.score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MATCH_CONFIG.candidatesMax);

  const candidates: FillCandidate[] = ranked.map(({ p, pos }) => ({
    invite_token: createInviteToken(run.id, p.id),
    first_name: p.first_name?.trim() || "Player",
    last_initial: lastInitial(p.last_name),
    stars: stars.real.get(p.id) ?? null,
    position: positionLabel(pos.primary),
    town: townFromZip(p.zip_code),
    invited: inviteState.invited.has(p.id),
  }));

  return {
    candidates,
    invites_available: inviteState.available,
    invites_sent: inviteState.invited.size,
    invite_limit: MATCH_CONFIG.invitesPerGame,
  };
}

export async function sendHostInvite(admin: SupabaseClient, access: HostRunAccess, callerId: string, token: string) {
  const { run } = access;
  const inviteeId = readInviteToken(token, run.id);
  if (!inviteeId) throw new MatchError(400, "This invite is not valid for this game.");
  if (inviteeId === run.created_by || inviteeId === callerId) throw new MatchError(400, "You cannot invite yourself.");

  const profiles = await loadMatchProfiles(admin, [inviteeId]);
  if (profiles.error) fail("player", profiles.error);
  const invitee = profiles.byId.get(inviteeId);
  if (!invitee || invitee.approved !== true) throw new MatchError(404, "Player not found.");
  if (!allowsHostInvites(invitee)) throw new MatchError(409, "This player is not taking invites.");

  const rsvp = await admin.from("pickup_run_rsvps").select("status").eq("run_id", run.id).eq("user_id", inviteeId);
  if (rsvp.error) fail("RSVPs", rsvp.error);
  const statuses = ((rsvp.data ?? []) as { status: string | null }[]).map((r) => String(r.status ?? "").toLowerCase());
  if (statuses.includes("declined")) throw new MatchError(409, "This player declined this game.");
  if (statuses.some((s) => !INACTIVE_RSVP_STATUSES.has(s))) throw new MatchError(409, "This player is already in this game.");

  const existing = await admin.from(HOST_INVITES_TABLE).select("invitee_id").eq("run_id", run.id);
  if (existing.error) {
    if (looksLikeMissingRelation(existing.error, HOST_INVITES_TABLE)) {
      throw new MatchError(503, "Invites are temporarily unavailable.");
    }
    fail("invites", existing.error);
  }
  const invitedIds = ((existing.data ?? []) as { invitee_id: string }[]).map((r) => r.invitee_id);
  if (invitedIds.includes(inviteeId)) {
    return { already_invited: true, invites_sent: invitedIds.length, invite_limit: MATCH_CONFIG.invitesPerGame };
  }
  if (invitedIds.length >= MATCH_CONFIG.invitesPerGame) {
    throw new MatchError(429, `This game has used all ${MATCH_CONFIG.invitesPerGame} invites.`, { limit_reached: true });
  }

  const ins = await admin.from(HOST_INVITES_TABLE).insert({ run_id: run.id, invitee_id: inviteeId, inviter_id: callerId });
  if (ins.error) {
    if (ins.error.code === "23505" || /duplicate|unique/i.test(ins.error.message)) {
      return { already_invited: true, invites_sent: invitedIds.length, invite_limit: MATCH_CONFIG.invitesPerGame };
    }
    fail("invite", ins.error);
  }

  const { data: tierRow } = await admin.from("profiles").select("tier_rank").eq("id", inviteeId).maybeSingle();
  const delivered = await deliverRunInvite(admin, {
    run: { id: run.id, start_at: run.start_at },
    inviteeId,
    inviteeTierRank: (tierRow as { tier_rank?: number | null } | null)?.tier_rank ?? null,
    inviterId: callerId,
  });
  if (!delivered.ok) {
    const undo = await admin.from(HOST_INVITES_TABLE).delete().eq("run_id", run.id).eq("invitee_id", inviteeId);
    if (undo.error) console.error("[match] invite rollback failed:", undo.error.message);
    throw new MatchError(500, delivered.error);
  }

  return { already_invited: false, invites_sent: invitedIds.length + 1, invite_limit: MATCH_CONFIG.invitesPerGame };
}
