import { siteOrigin } from "@/lib/env";

type MissingSiteUrlFailure = { ok: false; status: 0; error: "missing_site_url" };

const MISSING_SITE_URL: MissingSiteUrlFailure = { ok: false, error: "missing_site_url", status: 0 };

function missingSiteUrlAdminResult<T>(): AdminApiResult<T> {
  return MISSING_SITE_URL;
}

/** Returns site origin, or a transport failure when `EXPO_PUBLIC_SITE_URL` is unset (same shape as `AdminApiResult` error). */
function originOrThrow(): string | MissingSiteUrlFailure {
  const o = siteOrigin();
  if (!o) return MISSING_SITE_URL;
  return o;
}

async function jsonOrNull(r: Response): Promise<unknown | null> {
  return await r.json().catch(() => null);
}

function formatAdminFetchError(r: Response, j: unknown): string {
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  }
  const st = r.status;
  const stText = r.statusText?.trim();
  if (st === 404) {
    return "Not found (HTTP 404). Deploy the latest site, or check EXPO_PUBLIC_SITE_URL.";
  }
  if (st === 422) {
    return "Invalid request (HTTP 422). Check IDs or run state.";
  }
  if (st === 405) {
    return "Method not allowed (HTTP 405). Deploy the latest API (room delete uses POST /delete on older setups).";
  }
  if (!st) return "Network error check connection and EXPO_PUBLIC_SITE_URL.";
  return stText ? `HTTP ${st} ${stText}` : `HTTP ${st}`;
}

export type AdminApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; detail?: unknown };

async function adminFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<AdminApiResult<T>> {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return missingSiteUrlAdminResult<T>();
  }
  let r: Response;
  try {
    r = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg || "Network error" };
  }
  const j = await jsonOrNull(r);
  if (!r.ok) return { ok: false, status: r.status, error: formatAdminFetchError(r, j), detail: j };
  return { ok: true, status: r.status, data: j as T };
}

export type PickupOverviewResponse = {
  region?: string | null;
  run: Record<string, unknown> | null;
  current_waiver_version?: string;
  confirmed: Record<string, unknown>[];
  standby: Record<string, unknown>[];
};

export function fetchAdminPickupOverview(accessToken: string, opts?: { region?: string }) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<PickupOverviewResponse>());
  }
  const u = new URL("/api/admin/pickup/overview", origin);
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupOverviewResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export type PickupAnalyticsResponse = {
  ok: boolean;
  overall: {
    lookback_days: number;
    total_runs_created: number;
    avg_attendance: number | null;
    rsvp_to_attended_pct: number | null;
    no_show_rate_pct: number | null;
    late_cancel_rate_pct: number | null;
  };
  per_region: {
    region: string;
    runs_created: number;
    avg_attendance: number | null;
    rsvp_to_attended_pct: number | null;
    no_show_rate_pct: number | null;
    late_cancel_rate_pct: number | null;
  }[];
  top_reliable: {
    user_id: string;
    full_name: string;
    tracked_pickups: number;
    reliability_score_pct: number;
    no_show_count: number;
    late_cancel_count: number;
  }[];
  bottom_reliable: {
    user_id: string;
    full_name: string;
    tracked_pickups: number;
    reliability_score_pct: number;
    no_show_count: number;
    late_cancel_count: number;
  }[];
  error?: string;
};

export function fetchAdminPickupAnalytics(accessToken: string, opts?: { region?: string }) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<PickupAnalyticsResponse>());
  }
  const u = new URL("/api/admin/pickup/analytics", origin);
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupAnalyticsResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export type AdminAnalyticsBestTimeSlot = {
  day_of_week: number;
  hour: number;
  avg_confirmed: number;
  run_count: number;
};

export type AdminAnalyticsDashboardResponse = {
  ok: boolean;
  month: string;
  revenue: { current_month_cents: number; prev_month_cents: number };
  runs_per_region: { region: string; count: number }[];
  attendance: { avg_attendance_rate: number | null };
  most_active_players: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    instagram: string | null;
    sessions_this_month: number;
  }[];
  churn_at_risk: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    instagram: string | null;
    last_attended_at: string | null;
  }[];
  best_times: AdminAnalyticsBestTimeSlot[];
  players_by_venue?: { venue: string; count: number }[];
  players_by_zip?: { zip_code: string; count: number }[];
  error?: string;
};

export function fetchAdminAnalyticsDashboard(
  accessToken: string,
  opts?: { month?: string; schedule_region?: string | null },
) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<AdminAnalyticsDashboardResponse>());
  }
  const u = new URL("/api/admin/analytics", origin);
  if (opts?.month) u.searchParams.set("month", opts.month);
  const reg = opts?.schedule_region != null ? String(opts.schedule_region).trim().toUpperCase() : "";
  if (reg && reg !== "ALL") u.searchParams.set("schedule_region", reg);
  return adminFetch<AdminAnalyticsDashboardResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminCreateRun(
  accessToken: string,
  body: {
    title?: string;
    run_type?: "select" | "public";
    /** Required for select runs when time_slots omitted; omitted for public (server assigns next-day poll slots). */
    start_at?: string;
    /** Select planning runs: 1–5 kickoff options (ISO strings). First slot becomes run.start_at. */
    time_slots?: string[];
        capacity?: number;
        fee_cents?: number;
        admin_fee_cents?: number;
        service_region?: string | null;
    location_private?: string | null;
    location_text?: string | null;
    venue_zip_code?: string | null;
    cancellation_deadline?: string | null;
  },
) {
  return adminFetch<{ ok: boolean; run?: Record<string, unknown>; error?: string }>(
    "/api/admin/pickup/create-run",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export type InvitePlayersFormPlayer = {
  id: string;
  display_name: string;
  username: string | null;
  instagram: string | null;
  tier_rank: number | null;
  distance_minutes: number | null;
};

export function fetchAdminPickupInvitePlayersForm(accessToken: string, runId: string) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(
      missingSiteUrlAdminResult<{ run: Record<string, unknown>; players: InvitePlayersFormPlayer[] }>(),
    );
  }
  const u = new URL("/api/admin/pickup/invite-players", origin);
  u.searchParams.set("run_id", runId);
  return adminFetch<{ run: Record<string, unknown>; players: InvitePlayersFormPlayer[] }>(
    u.pathname + u.search,
    accessToken,
    { method: "GET" },
  );
}

export function postAdminPickupInvitePlayers(
  accessToken: string,
  body: { run_id: string; user_ids: string[] },
) {
  return adminFetch<{ ok: boolean; invited?: number; already_invited?: number; error?: string }>(
    "/api/admin/pickup/invite-players",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function postAdminCancelRun(accessToken: string, body: { run_id: string; reason?: string | null }) {
  return adminFetch<{ ok: boolean; credited?: string[]; creditFailed?: unknown; error?: string }>(
    "/api/admin/pickup/cancel",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function postAdminPromote(accessToken: string, body: { run_id: string; promote_user_id: string }) {
  return adminFetch<{ ok: boolean; status?: string; error?: string }>(
    "/api/admin/pickup/promote",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function postAdminMarkAttendance(
  accessToken: string,
  body: { run_id: string; attendance: { user_id: string; attended: boolean }[] },
) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/mark-attendance", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminLateCancel(accessToken: string, body: { run_id: string; user_id: string; note?: string | null }) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/late-cancel", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminConfirmPickupFromAvailability(accessToken: string, body: { run_id: string; user_id: string }) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/confirm-from-availability", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteAdminPickupRunAvailability(accessToken: string, body: { run_id: string; user_id: string }) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/run-availability", accessToken, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchAdminPickupResult(accessToken: string, runId: string) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(
      missingSiteUrlAdminResult<{
        ok: boolean;
        result: Record<string, unknown> | null;
        team_assignments: { user_id: string; team: string }[];
        error?: string;
      }>(),
    );
  }
  const u = new URL("/api/admin/pickup/result", origin);
  u.searchParams.set("run_id", runId);
  return adminFetch<{
    ok: boolean;
    result: Record<string, unknown> | null;
    team_assignments: { user_id: string; team: string }[];
    error?: string;
  }>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminPickupResult(
  accessToken: string,
  body: {
    run_id: string;
    total_teams: 2 | 3;
    winning_team: "A" | "B" | "C";
    team_assignments: { user_id: string; team: "A" | "B" | "C" }[];
    player_of_day?: string | null;
    goalie_of_the_day?: string | null;
    defender_of_day?: string | null;
    midfielder_of_day?: string | null;
    attacker_of_day?: string | null;
  },
) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/result", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminAssignPickupTeams(
  accessToken: string,
  body: {
    run_id: string;
    total_teams: 2 | 3;
    team_assignments: { user_id: string; team: "A" | "B" | "C" }[];
  },
) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/pickup/assign-teams", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminEndRun(accessToken: string, body: { run_id: string }) {
  return adminFetch<{ ok: boolean; run?: Record<string, unknown>; mode?: string; error?: string }>(
    "/api/admin/pickup/end-run",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export type TierSuggestionRow = {
  id: string;
  user_id: string;
  current_tier: string | null;
  suggested_tier: string;
  reason: string | null;
  runs_attended: number;
  attendance_rate: number;
  no_show_count: number;
  created_at: string;
  reviewed: boolean;
  accepted: boolean | null;
  profile: {
    id: string;
    full_name: string;
    instagram: string | null;
    tier: string | null;
    tier_rank: number | null;
  } | null;
};

export type TierSuggestionsListResponse = {
  ok: boolean;
  suggestions: TierSuggestionRow[];
  pending_count: number;
  error?: string;
};

export function fetchAdminTierSuggestions(accessToken: string) {
  return adminFetch<TierSuggestionsListResponse>("/api/admin/tier-suggestions", accessToken, { method: "GET" });
}

export function postAdminRunTierSuggestionAlgorithm(accessToken: string) {
  return adminFetch<{ ok: boolean; inserted: number; candidates: number; error?: string }>(
    "/api/admin/tier-suggestions/run",
    accessToken,
    { method: "POST" },
  );
}

export function postAdminReviewTierSuggestion(accessToken: string, id: string, accepted: boolean) {
  return adminFetch<{ ok: boolean; accepted: boolean; error?: string }>(
    `/api/admin/tier-suggestions/${encodeURIComponent(id)}/review`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted }),
    },
  );
}

export type StandingListResponse = {
  filter: string;
  limit: number;
  offset: number;
  rows: Record<string, unknown>[];
  currentWaiverVersion?: string;
  total_estimate?: number;
};

export function fetchAdminPickupStanding(
  accessToken: string,
  opts?: { filter?: string; q?: string; limit?: number; offset?: number },
) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<StandingListResponse>());
  }
  const u = new URL("/api/admin/pickup/standing", origin);
  if (opts?.filter) u.searchParams.set("filter", opts.filter);
  if (opts?.q) u.searchParams.set("q", opts.q);
  if (opts?.limit != null) u.searchParams.set("limit", String(opts.limit));
  if (opts?.offset != null) u.searchParams.set("offset", String(opts.offset));
  return adminFetch<StandingListResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function patchAdminPickupStanding(
  accessToken: string,
  body: {
    user_id: string;
    manual_standing?: "good" | "warning" | "suspended" | "banned" | null;
    manual_reason?: string | null;
    staff_notes?: string | null;
    reliability_override_score_pct?: number | null;
    reliability_override_reason?: string | null;
  },
) {
  return adminFetch<{ ok: boolean; standing?: Record<string, unknown>; error?: string }>(
    "/api/admin/pickup/standing",
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export type ChatRoomType = "public" | "announcement" | "group" | "run_banter" | "tournament_team";

export type ChatRoom = {
  id: string;
  slug: string;
  title: string;
  room_type: ChatRoomType;
  is_active: boolean;
  announcements_only: boolean;
  closes_at: string | null;
  created_at: string;
  created_by: string | null;
};

export function fetchAdminChatRooms(accessToken: string) {
  return adminFetch<{ ok: boolean; rooms: ChatRoom[]; error?: string }>(
    "/api/admin/chat/rooms",
    accessToken,
    { method: "GET" },
  );
}

export function postAdminChatRoom(
  accessToken: string,
  body: {
    slug: string;
    title: string;
    room_type?: ChatRoomType;
    is_active?: boolean;
    announcements_only?: boolean;
    closes_at?: string | null;
    member_user_ids?: string[];
    member_tier_ranks?: number[];
  },
) {
  return adminFetch<{
    ok: boolean;
    room?: ChatRoom;
    member_count?: number;
    member_error?: string;
    error?: string;
  }>("/api/admin/chat/rooms", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchAdminChatRoom(accessToken: string, roomId: string) {
  return adminFetch<{ ok: boolean; room?: ChatRoom; error?: string }>(
    `/api/admin/chat/rooms/${encodeURIComponent(roomId)}`,
    accessToken,
    { method: "GET" },
  );
}

export function patchAdminChatRoom(
  accessToken: string,
  roomId: string,
  body: Partial<Pick<ChatRoom, "slug" | "title" | "is_active" | "announcements_only" | "closes_at">>,
) {
  return adminFetch<{ ok: boolean; room?: ChatRoom; error?: string }>(
    `/api/admin/chat/rooms/${encodeURIComponent(roomId)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteAdminChatRoom(accessToken: string, roomId: string) {
  return adminFetch<{ ok: boolean; deleted?: Pick<ChatRoom, "id" | "slug" | "title">; error?: string }>(
    `/api/admin/chat/rooms/${encodeURIComponent(roomId)}/delete`,
    accessToken,
    { method: "POST" },
  );
}

/** Deletes a single chat message in the room (admin). Uses `DELETE …?message_id=`; room delete uses POST `/delete`. */
export function deleteAdminChatMessage(accessToken: string, roomId: string, messageId: string) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<{ ok: boolean; deleted_message_id?: string; error?: string }>());
  }
  const u = new URL(`/api/admin/chat/rooms/${encodeURIComponent(roomId)}`, origin);
  u.searchParams.set("message_id", messageId);
  return adminFetch<{ ok: boolean; deleted_message_id?: string; error?: string }>(
    u.pathname + u.search,
    accessToken,
    { method: "DELETE" },
  );
}

export type ChatRoomMute = {
  id: string;
  room_id: string;
  user_id: string;
  muted_by: string | null;
  muted_until: string | null;
  reason: string | null;
  created_at: string;
};

export function fetchAdminChatRoomMutes(accessToken: string, roomId: string) {
  return adminFetch<{ ok: boolean; mutes: ChatRoomMute[]; error?: string }>(
    `/api/admin/chat/rooms/${encodeURIComponent(roomId)}/mutes`,
    accessToken,
    { method: "GET" },
  );
}

export function postAdminChatRoomMute(
  accessToken: string,
  roomId: string,
  body: { user_id: string; muted_until?: string | null; reason?: string | null },
) {
  return adminFetch<{ ok: boolean; mute?: ChatRoomMute; error?: string }>(
    `/api/admin/chat/rooms/${encodeURIComponent(roomId)}/mutes`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteAdminChatRoomMute(accessToken: string, roomId: string, userId: string) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<{ ok: boolean; error?: string }>());
  }
  const u = new URL(`/api/admin/chat/rooms/${encodeURIComponent(roomId)}/mutes`, origin);
  u.searchParams.set("user_id", userId);
  return adminFetch<{ ok: boolean; error?: string }>(u.pathname + u.search, accessToken, { method: "DELETE" });
}

export function postAdminAnnouncement(
  accessToken: string,
  body: { room_id?: string; room_slug?: string; message: string },
) {
  return adminFetch<{
    ok: boolean;
    pushed?: number;
    room_id?: string;
    room_slug?: string;
    room_type?: string;
    error?: string;
  }>("/api/admin/chat/announce", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchAdminBulkMessageCount(
  accessToken: string,
  opts: { filter: string; filter_value?: string | null },
) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<{ ok: boolean; count: number }>());
  }
  const u = new URL("/api/admin/bulk-message", origin);
  u.searchParams.set("filter", opts.filter);
  if (opts.filter_value != null && String(opts.filter_value).trim()) {
    u.searchParams.set("filter_value", String(opts.filter_value).trim());
  }
  return adminFetch<{ ok: boolean; count: number }>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminBulkMessage(
  accessToken: string,
  body: {
    filter: "all" | "region" | "tier" | "run";
    filter_value?: string | null;
    message: string;
  },
) {
  return adminFetch<{ ok: boolean; sent_to: number }>("/api/admin/bulk-message", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Outdoor / captain tournament hub (`/tournament` on the website). */
export type AdminOutdoorTournament = {
  id: string;
  title: string;
  slug: string;
  is_active: boolean;
  service_region?: string | null;
  target_teams: number | null;
  official_threshold: number | null;
  max_teams: number | null;
  created_at?: string | null;
  start_at?: string | null;
  venue?: string | null;
  canceled_at?: string | null;
};

export type TournamentCaptainRow = {
  id: string;
  status: string;
  captain_name: string | null;
  team_name: string | null;
  captain_instagram?: string | null;
  captain_verified?: boolean | null;
  claim_submitted_at: string | null;
  user_id?: string;
  expected_players?: number | null;
  players_paid?: number | null;
  payment_received_at?: string | null;
  roster_size?: number;
};

export type TourneySubmissionRow = {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  decision: string | null;
  notes: string | null;
  reviewed: boolean | null;
  meta?: unknown;
};

export type AdminTournamentsPanelResponse = {
  ok: boolean;
  tournaments: AdminOutdoorTournament[];
  active_tournament?: Record<string, unknown> | null;
  captains?: TournamentCaptainRow[];
  submissions?: TourneySubmissionRow[];
  panel_error?: string;
  error?: string;
};

export function fetchAdminOutdoorTournaments(
  accessToken: string,
  opts?: { region?: string; includePanel?: boolean; submissionDecision?: string },
) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<AdminTournamentsPanelResponse>());
  }
  const u = new URL("/api/admin/tournaments", origin);
  if (opts?.region) u.searchParams.set("region", opts.region);
  if (opts?.includePanel) u.searchParams.set("include", "panel");
  if (opts?.submissionDecision) u.searchParams.set("decision", opts.submissionDecision);
  return adminFetch<AdminTournamentsPanelResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminTournaments(accessToken: string, body: Record<string, unknown>) {
  return adminFetch<{ ok: boolean; error?: string; tournament?: unknown }>("/api/admin/tournaments", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteAdminTournament(accessToken: string, id: string) {
  return adminFetch<{ ok: boolean; error?: string }>("/api/admin/tournaments", accessToken, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export type AdminBracketRosterPlayer = {
  name: string;
  team_id: string;
  team_name: string;
};

export type AdminBracketMatchGoal = {
  team_id: string;
  scorer_name: string;
  minute: number | null;
  is_own_goal: boolean;
};

export type AdminTournamentBracketResponse = {
  teams: { id: string; team_name: string; captain_name: string }[];
  matches: Record<string, unknown>[];
  standings: Record<string, unknown>[];
  roster_players?: AdminBracketRosterPlayer[];
  match_goals?: Record<string, AdminBracketMatchGoal[]>;
  error?: string;
};

export function fetchAdminTournamentBracket(accessToken: string, tournamentId: string) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<AdminTournamentBracketResponse>());
  }
  const u = new URL("/api/admin/tournaments/bracket", origin);
  u.searchParams.set("tournament_id", tournamentId);
  return adminFetch<AdminTournamentBracketResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminTournamentBracket(
  accessToken: string,
  body: Record<string, unknown>,
) {
  return adminFetch<{ ok?: boolean; message?: string; error?: string }>("/api/admin/tournaments/bracket", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminSetHubTournament(accessToken: string, tournamentId: string | null) {
  return adminFetch<{
    ok: boolean;
    action?: string;
    effects?: { record: string; detail: string }[];
    error?: string;
  }>("/api/admin/operator", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_hub_tournament", tournament_id: tournamentId }),
  });
}

/** Set which pickup run is featured on the public `/pickup` hub for its region (or clear with `null`). */
export function postAdminSetHubPickup(accessToken: string, run_id: string | null) {
  if (run_id === null) {
    return adminFetch<{
      ok: boolean;
      action?: string;
      wave_warning?: string | null;
      effects?: { record: string; detail: string }[];
      error?: string;
    }>("/api/admin/operator", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_hub_pickup", run_id }),
    });
  }
  return adminFetch<{
    ok: boolean;
    action?: string;
    wave_warning?: string | null;
    wave_outreach?: { wave1_invited: number; next_wave_at: string | null } | null;
    error?: string;
  }>("/api/admin/pickup/promote", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id, target: "hub" }),
  });
}

export type PickupSwitchListResponse = {
  runs: Record<string, unknown>[];
};

export type PickupSwitchDetailResponse = PickupSwitchListResponse & {
  run: Record<string, unknown> | null;
  slots: Record<string, unknown>[];
  availability: Record<string, unknown>[];
  invites: Record<string, unknown>[];
  rsvps: Record<string, unknown>[];
  confirmed: { id: string; full_name: string | null; playing_position?: string | null }[];
  standby: { id: string; full_name: string | null }[];
  counts: {
    invites: number;
    available: number;
    declined: number;
    confirmed: number;
    standby: number;
    pending_payment: number;
    waitlist: number;
  };
  auto_status: Record<string, unknown>;
  updates: { global: Record<string, unknown> | null; run: Record<string, unknown> | null };
};

export function fetchAdminPickupSwitchList(accessToken: string, opts?: { region?: string }) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<PickupSwitchListResponse>());
  }
  const u = new URL("/api/pickup/switch", origin);
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupSwitchListResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function fetchAdminPickupSwitchDetail(accessToken: string, runId: string, opts?: { region?: string }) {
  const origin = originOrThrow();
  if (typeof origin !== "string") {
    return Promise.resolve(missingSiteUrlAdminResult<PickupSwitchDetailResponse>());
  }
  const u = new URL("/api/pickup/switch", origin);
  u.searchParams.set("run_id", runId);
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupSwitchDetailResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminPickupSwitch(accessToken: string, body: Record<string, unknown>) {
  return adminFetch<Record<string, unknown>>("/api/pickup/switch", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAdminDeleteRun(accessToken: string, runId: string) {
  return adminFetch<{ ok: boolean; error?: string }>(
    "/api/admin/pickup/delete-run",
    accessToken,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runId }) },
  );
}

export type MonthlyLeadersLeaderRow = { user_id: string; count: number; name: string };

export type MonthlyLeadersResponse = {
  month_key: string;
  previous_month_key: string;
  pod_top: MonthlyLeadersLeaderRow[];
  attendance_top: MonthlyLeadersLeaderRow[];
  last_month_winners: {
    user_id: string;
    reason: string;
    name: string;
    discount_pct: number | null;
  }[];
};

export function fetchAdminMonthlyLeaders(accessToken: string) {
  return adminFetch<MonthlyLeadersResponse>("/api/admin/pickup/monthly-leaders", accessToken, {
    method: "GET",
  });
}

export type ProximitySearchPlayer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  zip_code: string;
  drive_minutes: number;
};

export type ProximitySearchResponse = {
  venue: string;
  max_minutes: number;
  count: number;
  players: ProximitySearchPlayer[];
};

export function fetchAdminPlayersProximity(accessToken: string, venue: string, maxMinutes: number) {
  const q = new URLSearchParams({
    venue: venue.trim(),
    max_minutes: String(maxMinutes),
  });
  return adminFetch<ProximitySearchResponse>(`/api/admin/players/proximity?${q.toString()}`, accessToken, {
    method: "GET",
  });
}

