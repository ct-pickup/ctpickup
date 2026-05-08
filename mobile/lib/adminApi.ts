import { siteOrigin } from "@/lib/env";

function originOrThrow(): string {
  const o = siteOrigin();
  if (!o) throw new Error("Missing EXPO_PUBLIC_SITE_URL");
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
  const u = new URL("/api/admin/pickup/analytics", origin);
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupAnalyticsResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function postAdminCreateRun(
  accessToken: string,
  body: {
    title?: string;
    run_type?: "select" | "public";
    start_at: string;
    capacity?: number;
    fee_cents?: number;
    service_region?: string | null;
    location_text?: string | null;
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

export function postAdminCancelRun(accessToken: string, body: { run_id: string; reason?: string | null }) {
  return adminFetch<{ ok: boolean; refunded?: string[]; failed?: unknown; error?: string }>(
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

export function postAdminPickupResult(
  accessToken: string,
  body: {
    run_id: string;
    total_teams: 2 | 3;
    winning_team: "A" | "B" | "C";
    team_assignments: { user_id: string; team: "A" | "B" | "C" }[];
    player_of_day?: string | null;
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
  const u = new URL("/api/admin/pickup/standing", originOrThrow());
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

export type ChatRoomType = "public" | "announcement" | "group";

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
  const u = new URL(`/api/admin/chat/rooms/${encodeURIComponent(roomId)}`, originOrThrow());
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
  const u = new URL(`/api/admin/chat/rooms/${encodeURIComponent(roomId)}/mutes`, originOrThrow());
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
};

export type TournamentCaptainRow = {
  id: string;
  status: string;
  captain_name: string | null;
  team_name: string | null;
  claim_submitted_at: string | null;
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
  const u = new URL("/api/admin/tournaments", originOrThrow());
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
  return adminFetch<{
    ok: boolean;
    action?: string;
    effects?: { record: string; detail: string }[];
    error?: string;
  }>("/api/admin/operator", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_hub_pickup", run_id }),
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
  confirmed: { id: string; full_name: string | null }[];
  standby: { id: string; full_name: string | null }[];
  counts: {
    invites: number;
    available: number;
    declined: number;
    confirmed: number;
    standby: number;
    pending_payment: number;
  };
  auto_status: Record<string, unknown>;
  updates: { global: Record<string, unknown> | null; run: Record<string, unknown> | null };
};

export function fetchAdminPickupSwitchList(accessToken: string, opts?: { region?: string }) {
  const u = new URL("/api/pickup/switch", originOrThrow());
  if (opts?.region) u.searchParams.set("region", opts.region);
  return adminFetch<PickupSwitchListResponse>(u.pathname + u.search, accessToken, { method: "GET" });
}

export function fetchAdminPickupSwitchDetail(accessToken: string, runId: string, opts?: { region?: string }) {
  const u = new URL("/api/pickup/switch", originOrThrow());
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

export type AdminEsportsTournamentRow = {
  id: string;
  title: string;
  game: string;
  prize: string;
  start_date: string;
  end_date: string;
  status: string;
  description: string | null;
  format_summary: string | null;
  created_at: string;
  group_stage_deadline_1?: string | null;
  group_stage_deadline_2?: string | null;
  group_stage_final_deadline?: string | null;
  knockout_start_at?: string | null;
  quarterfinal_deadline?: string | null;
  semifinal_deadline?: string | null;
  final_deadline?: string | null;
};

export function fetchAdminEsportsTournaments(accessToken: string) {
  return adminFetch<{ ok: boolean; tournaments: AdminEsportsTournamentRow[]; error?: string }>(
    "/api/admin/esports/tournaments",
    accessToken,
    { method: "GET" },
  );
}

export function postAdminEsportsTournament(accessToken: string, body: Record<string, unknown>) {
  return adminFetch<{ ok: boolean; tournament?: AdminEsportsTournamentRow; error?: string }>(
    "/api/admin/esports/tournaments",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/** Full tournament update (includes `title`); use `patchAdminEsportsTournamentStatus` for status-only. */
export function patchAdminEsportsTournament(accessToken: string, tournamentId: string, body: Record<string, unknown>) {
  return adminFetch<{ ok: boolean; tournament?: AdminEsportsTournamentRow; error?: string }>(
    `/api/admin/esports/tournaments/${encodeURIComponent(tournamentId)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function patchAdminEsportsTournamentStatus(
  accessToken: string,
  tournamentId: string,
  status: "upcoming" | "active" | "completed",
) {
  return patchAdminEsportsTournament(accessToken, tournamentId, { status });
}

export function deleteAdminEsportsTournament(accessToken: string, tournamentId: string) {
  return adminFetch<{ ok: boolean; deleted_id?: string; error?: string }>(
    `/api/admin/esports/tournaments/${encodeURIComponent(tournamentId)}`,
    accessToken,
    { method: "DELETE" },
  );
}

