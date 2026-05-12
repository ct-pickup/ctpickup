import { siteOrigin } from "@/lib/env";

/** Authenticated pickup RSVP (same contract as the CT Pickup API server — no in-app browser except optional Stripe checkout URL). */
export async function postPickupRsvp(
  accessToken: string,
  runId: string,
  action: "join" | "decline",
  opts?: { friend_user_id?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const body: Record<string, unknown> = { run_id: runId, action };
  if (opts?.friend_user_id) body.friend_user_id = opts.friend_user_id;
  const r = await fetch(`${origin}/api/pickup/rsvp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

export type PickupFindPlayerResult = {
  user_id: string;
  full_name: string;
  username: string | null;
};

/** Autocomplete search for “pay for a friend” (debounced on the client). */
export async function fetchPickupFindPlayers(
  accessToken: string,
  q: string,
  limit = 5,
): Promise<{ ok: boolean; status: number; players: PickupFindPlayerResult[] }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, players: [] };
  }
  const u = new URL(`${origin}/api/pickup/find-player`);
  u.searchParams.set("q", q.trim());
  u.searchParams.set("limit", String(limit));
  const r = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as unknown;
  if (!r.ok || !Array.isArray(json)) {
    return { ok: r.ok, status: r.status, players: [] };
  }
  const players: PickupFindPlayerResult[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.user_id !== "string") continue;
    const fn = typeof o.full_name === "string" ? o.full_name : "";
    players.push({
      user_id: o.user_id,
      full_name: fn,
      username: typeof o.username === "string" ? o.username : null,
    });
  }
  return { ok: r.ok, status: r.status, players };
}

/**
 * Planning-phase availability commit (slot pick or decline). Mirrors the website's `submitAvailability`.
 * Either `slotId` or `slotLabel` may be supplied for `available`. When only `slotLabel` is sent,
 * the server resolves (or creates) a `pickup_run_time_slots` row for that run + label.
 */
export async function postPickupCommit(
  accessToken: string,
  runId: string,
  state: "available" | "declined",
  slotId: string | null,
  slotLabel: string | null = null,
  slotLabelsSelection: string[] | null = null,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const payload: Record<string, unknown> = {
    run_id: runId,
    state,
    slot_id: state === "available" ? slotId : null,
  };
  if (state === "available" && slotLabel) {
    payload.slot_label = slotLabel;
  }
  if (state === "available" && slotLabelsSelection && slotLabelsSelection.length > 0) {
    payload.slot_labels_selection = slotLabelsSelection;
  }
  const r = await fetch(`${origin}/api/pickup/commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Server creates a Stripe Checkout session for a pending-payment RSVP and returns `{ url }`. */
export async function postPickupPay(
  accessToken: string,
  runId: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const r = await fetch(`${origin}/api/pickup/pay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ run_id: runId }),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Active in-person (field) tournament hub — same payload as the website tournament page. */
export async function fetchTournamentPublic(opts?: {
  region?: string;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const u = new URL(`${origin}/api/tournament/public`);
  if (opts?.region) u.searchParams.set("region", opts.region);
  const r = await fetch(u.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

/** Records a tournament rules + media-consent agreement (mirrors the website's submitAgreement). */
export async function postTournamentConsent(
  accessToken: string,
  body: {
    full_name: string;
    signed_name: string;
    page: string;
    consent_version: string;
  },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const r = await fetch(`${origin}/api/tournament/consent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

export type CaptainClaimSubmission = {
  captainName: string;
  captainInstagram: string;
  teamName: string;
  expectedPlayers: number;
  prelimRoster: { fullName: string; instagram: string }[];
};

/** Submits a captain's tournament claim (rules consent must already be on file server-side). */
export async function postTournamentCaptainSubmitClaim(
  accessToken: string,
  payload: CaptainClaimSubmission,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const r = await fetch(`${origin}/api/tournament/captain/submit-claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

export type TournamentJoinCatalogTeam = {
  captain_id: string;
  team_name: string;
  captain_name: string;
  spots_remaining: number;
  expected_players: number;
};

export type TournamentJoinPendingRequest = {
  id: string;
  captain_id: string;
  status: string;
  message: string | null;
  created_at: string;
};

/** Confirmed teams + caller's pending join requests for join-team UX. */
export async function fetchTournamentJoinCatalog(
  accessToken: string,
  tournamentId: string,
  region: string,
): Promise<{
  ok: boolean;
  status: number;
  teams: TournamentJoinCatalogTeam[];
  my_pending_requests: TournamentJoinPendingRequest[];
}> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, teams: [], my_pending_requests: [] };
  }
  const u = new URL(`${origin}/api/tournament/roster`);
  u.searchParams.set("tournament_id", tournamentId);
  u.searchParams.set("join_catalog", "1");
  u.searchParams.set("region", region.trim().toUpperCase());
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const teams = Array.isArray(json.teams) ? (json.teams as TournamentJoinCatalogTeam[]) : [];
  const my_pending_requests = Array.isArray(json.my_pending_requests)
    ? (json.my_pending_requests as TournamentJoinPendingRequest[])
    : [];
  return { ok: r.ok, status: r.status, teams, my_pending_requests };
}

/** Captain roster + pending join requests (GET requires captain auth). */
export async function fetchTournamentRosterCaptain(accessToken: string, captainId: string) {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: null as unknown };
  }
  const u = new URL(`${origin}/api/tournament/roster`);
  u.searchParams.set("captain_id", captainId);
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

export async function postTournamentRoster(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const r = await fetch(`${origin}/api/tournament/roster`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Signed-in player read-only bracket (teams, matches, standings). */
export async function fetchTournamentBracketPlayer(accessToken: string, tournamentId: string) {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: null as unknown };
  }
  const u = new URL(`${origin}/api/tournament/bracket`);
  u.searchParams.set("tournament_id", tournamentId);
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

export async function fetchPickupPublic(
  accessToken: string | null,
  opts?: { region?: string; run_id?: string },
): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
}> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const u = new URL(`${origin}/api/pickup/public`);
  if (opts?.region) {
    u.searchParams.set("region", opts.region);
  }
  if (opts?.run_id) {
    u.searchParams.set("run_id", opts.run_id);
  }
  const r = await fetch(u.toString(), {
    headers: { ...headers, Accept: "application/json" },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

export async function postMobilePushToken(accessToken: string, expoPushToken: string, platform: "ios" | "android") {
  const origin = siteOrigin();
  if (!origin) return { ok: false as const, error: "missing_site_url" };
  const r = await fetch(`${origin}/api/mobile/push-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expo_push_token: expoPushToken, platform }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false as const, error: typeof j?.error === "string" ? j.error : "request_failed" };
  return { ok: true as const };
}

/**
 * App Store Guideline 4.5.4: persists the user's push notification opt-in.
 *
 * When enabling, pass the current Expo push token + platform so the server
 * can re-register the device immediately (mirrors `/api/mobile/push-token`).
 * When disabling, the server deletes the user's device rows so Expo can no
 * longer reach them.
 */
export async function postMobilePushPreference(
  accessToken: string,
  enabled: boolean,
  opts?: { expoPushToken?: string; platform?: "ios" | "android" },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "missing_site_url" };
  const body: Record<string, unknown> = { enabled };
  if (enabled && opts?.expoPushToken && opts.platform) {
    body.expo_push_token = opts.expoPushToken;
    body.platform = opts.platform;
  }
  const r = await fetch(`${origin}/api/mobile/push-preference`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: unknown };
  if (!r.ok) {
    const err = typeof j?.error === "string" ? j.error : "request_failed";
    return { ok: false, error: err };
  }
  return { ok: true };
}

export type EmailExistsResult =
  | { ok: true; exists: boolean }
  | { ok: false; reason: "missing_site_url" | "network" | "invalid_response" };

export async function checkEmailExistsResult(email: string): Promise<EmailExistsResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, reason: "missing_site_url" };
  try {
    const r = await fetch(`${origin}/api/auth/email-exists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || j === null || typeof j !== "object") return { ok: false, reason: "invalid_response" };
    return { ok: true, exists: Boolean((j as { exists?: unknown }).exists) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function checkEmailExists(email: string): Promise<boolean> {
  const r = await checkEmailExistsResult(email);
  return r.ok && r.exists;
}

/** Matches `GET /api/pickup/standing` (reliability score 0–100). */
export type PickupStandingApiResponse = {
  ok: boolean;
  authenticated: boolean;
  reliability?: {
    tracked_pickups: number;
    score_pct: number | null;
    bucket: string;
    user_label: string;
    user_subtext: string;
    confirmed_count: number;
    attended_count: number;
    no_show_count: number;
    late_cancel_count: number;
    override_score_pct?: number | null;
    override_reason?: string | null;
    override_updated_at?: string | null;
  };
};

export async function fetchPickupStanding(accessToken: string): Promise<{
  ok: boolean;
  status: number;
  data: PickupStandingApiResponse | null;
}> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, data: null };
  }
  const r = await fetch(`${origin}/api/pickup/standing`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as unknown;
  if (json == null || typeof json !== "object") {
    return { ok: false, status: r.status, data: null };
  }
  return { ok: r.ok, status: r.status, data: json as PickupStandingApiResponse };
}

export type PublicPlayerProfile = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  playing_position: string | null;
  plays_goalie: boolean | null;
};

/** In-app public card (team chat, etc.); requires approved viewer. */
export async function fetchPublicPlayerProfile(
  accessToken: string,
  userId: string,
): Promise<{ ok: true; profile: PublicPlayerProfile } | { ok: false; status: number; error: string }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, error: "missing_site_url" };
  }
  const r = await fetch(`${origin}/api/profile/public/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) {
    const err =
      json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : "request_failed";
    return { ok: false, status: r.status, error: err };
  }
  if (!json || typeof json !== "object" || !("id" in json)) {
    return { ok: false, status: r.status, error: "invalid_response" };
  }
  return { ok: true, profile: json as PublicPlayerProfile };
}
