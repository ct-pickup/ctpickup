import { siteOrigin } from "@/lib/env";

/**
 * Staff 1:1 threads. Only admins can start one (the server routes require an admin token); players
 * cannot start DMs, and this does not change that. A thread is a two-member "group" room whose slug
 * is derived from both user ids, so there is at most one per pair.
 */
async function call<T>(token: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing site URL." };
  try {
    const r = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok || !j) return { ok: false, error: j?.error ?? "Something went wrong. Try again." };
    return { ok: true, data: j };
  } catch {
    return { ok: false, error: "Couldn’t reach the server." };
  }
}

/** The existing thread with `userId`, or null when there is none yet. */
export async function findAdminDmRoom(token: string, userId: string) {
  const res = await call<{ room_id: string | null }>(token, `/api/admin/dm?user_id=${encodeURIComponent(userId)}`);
  return res.ok ? { ok: true as const, roomId: res.data.room_id ?? null } : res;
}

/** Creates the thread if needed and sends the first message. */
export async function startAdminDm(token: string, userId: string, message: string) {
  const res = await call<{ room_id: string }>(token, "/api/admin/dm", { target_user_id: userId, message });
  return res.ok ? { ok: true as const, roomId: res.data.room_id } : res;
}
