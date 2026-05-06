import type { SupabaseClient } from "@supabase/supabase-js";

export type ExpoPushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushBatchResult = { ok: boolean; status?: number; error?: string };

export type SendPushResult = {
  tokens: number;
  batches: PushBatchResult[];
  /** Token lookup failed before calling Expo (caller may want to HTTP 500). */
  lookupError?: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;
/** Matches app/api/admin/chat/announce — bulk sends; bodies truncated to 100 chars in that route. */
const MAX_TOKEN_QUERY = 4000;
const USER_ID_IN_CHUNK = 200;

async function sendTokensToExpo(
  tokens: string[],
  payload: ExpoPushPayload,
): Promise<SendPushResult> {
  const deduped = [...new Set(tokens)];
  const chunks: string[][] = [];
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    chunks.push(deduped.slice(i, i + BATCH_SIZE));
  }

  const batches: PushBatchResult[] = [];
  const { title, body, data } = payload;

  for (const chunk of chunks) {
    const messages = chunk.map((to) => ({
      to,
      title,
      body,
      sound: "default" as const,
      ...(data !== undefined ? { data } : {}),
    }));

    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        batches.push({ ok: false, status: r.status, error: j ? JSON.stringify(j) : "push_failed" });
      } else {
        batches.push({ ok: true, status: r.status });
      }
    } catch (e: unknown) {
      batches.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { tokens: deduped.length, batches };
}

/**
 * Looks up Expo tokens for the given users and sends notifications in batches of 100.
 */
export async function sendPushToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: ExpoPushPayload,
): Promise<SendPushResult> {
  const unique = Array.from(new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (!unique.length) return { tokens: 0, batches: [] };

  const tokens: string[] = [];

  for (let i = 0; i < unique.length; i += USER_ID_IN_CHUNK) {
    const slice = unique.slice(i, i + USER_ID_IN_CHUNK);
    const res = await admin.from("user_push_devices").select("expo_push_token").in("user_id", slice);
    if (res.error) {
      return { tokens: 0, batches: [], lookupError: res.error.message };
    }
    for (const row of res.data || []) {
      const t = (row as { expo_push_token?: unknown }).expo_push_token;
      if (typeof t === "string" && t.length > 10) tokens.push(t);
    }
  }

  return sendTokensToExpo(tokens, payload);
}

/**
 * Sends to every stored push token (capped at MAX_TOKEN_QUERY rows).
 */
export async function sendPushToAll(
  admin: SupabaseClient,
  payload: ExpoPushPayload,
): Promise<SendPushResult> {
  const res = await admin.from("user_push_devices").select("expo_push_token").limit(MAX_TOKEN_QUERY);
  if (res.error) {
    return { tokens: 0, batches: [], lookupError: res.error.message };
  }
  const tokens = (res.data ?? [])
    .map((r) => (r as { expo_push_token?: unknown }).expo_push_token)
    .filter((t): t is string => typeof t === "string" && t.length > 10);
  return sendTokensToExpo(tokens, payload);
}
