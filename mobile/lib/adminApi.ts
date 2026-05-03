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
  if (!st) return "Network error — check connection and EXPO_PUBLIC_SITE_URL.";
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

export type ChatRoom = {
  id: string;
  slug: string;
  title: string;
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
  body: { slug: string; title: string; is_active?: boolean; announcements_only?: boolean; closes_at?: string | null },
) {
  return adminFetch<{ ok: boolean; room?: ChatRoom; error?: string }>(
    "/api/admin/chat/rooms",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
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

export function postAdminAnnouncement(accessToken: string, body: { room_slug?: string; message: string }) {
  return adminFetch<{ ok: boolean; pushed?: number; error?: string }>(
    "/api/admin/chat/announce",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

