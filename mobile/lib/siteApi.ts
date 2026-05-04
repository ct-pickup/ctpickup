import { siteOrigin } from "@/lib/env";

/** Authenticated pickup RSVP (same contract as the CT Pickup API server — no in-app browser except optional Stripe checkout URL). */
export async function postPickupRsvp(
  accessToken: string,
  runId: string,
  action: "join" | "decline",
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { error: "missing_site_url" } };
  }
  const r = await fetch(`${origin}/api/pickup/rsvp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ run_id: runId, action }),
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

export async function fetchPickupPublic(
  accessToken: string | null,
  opts?: { region?: string },
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
