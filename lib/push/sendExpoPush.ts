import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCTION_PUSH_INSTALLATION_CONTEXTS } from "@/lib/push/registerUserPushDevice";

export type ExpoPushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushBatchResult = {
  ok: boolean;
  status?: number;
  error?: string;
  ticketsOk?: number;
  ticketsError?: number;
  ticketErrorTypes?: string[];
};

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

type ExpoPushTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

function isLikelyExpoPushToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[[\w-]+\]$/i.test(t);
}

function summarizeExpoTickets(tickets: ExpoPushTicket[]): {
  ok: number;
  error: number;
  errorTypes: string[];
  messages: string[];
} {
  let ok = 0;
  let error = 0;
  const errorTypes = new Set<string>();
  const messages: string[] = [];
  for (const ticket of tickets) {
    if (ticket?.status === "ok") ok += 1;
    else if (ticket?.status === "error") {
      error += 1;
      const et = ticket.details?.error;
      if (typeof et === "string" && et) errorTypes.add(et);
      if (typeof ticket.message === "string" && ticket.message) messages.push(ticket.message);
    }
  }
  return { ok, error, errorTypes: [...errorTypes], messages: messages.slice(0, 5) };
}

function expoPushApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

/** Structured logs for Vercel / server runtime (search `expo-push` in logs). */
function logExpoPush(
  level: "info" | "warn" | "error",
  message: string,
  data: Record<string, unknown>,
): void {
  const payload = { tag: "expo-push", message, ...data };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function deleteDeviceNotRegisteredTokens(
  admin: SupabaseClient,
  chunk: string[],
  tickets: ExpoPushTicket[],
) {
  for (let idx = 0; idx < tickets.length; idx++) {
    const ticket = tickets[idx];
    if (
      ticket?.status === "error" &&
      ticket.details?.error === "DeviceNotRegistered" &&
      typeof chunk[idx] === "string"
    ) {
      await admin.from("user_push_devices").delete().eq("expo_push_token", chunk[idx]);
    }
  }
}

async function sendTokensToExpo(
  admin: SupabaseClient,
  tokens: string[],
  payload: ExpoPushPayload,
): Promise<SendPushResult> {
  const deduped = [...new Set(tokens.filter((t) => isLikelyExpoPushToken(t)))];
  const invalidFormat = tokens.length - deduped.length;
  if (invalidFormat > 0) {
    logExpoPush("warn", "skipped invalid expo push token format", { invalidFormat, inputCount: tokens.length });
  }
  if (!deduped.length) {
    logExpoPush("warn", "no valid tokens to send", { inputCount: tokens.length });
    return { tokens: 0, batches: [] };
  }

  if (!process.env.EXPO_ACCESS_TOKEN?.trim()) {
    logExpoPush("warn", "EXPO_ACCESS_TOKEN not set — required if Expo Push Security is enabled on your account", {});
  }

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
        headers: expoPushApiHeaders(),
        body: JSON.stringify(messages),
      });
      const parsed = (await r.json().catch(() => null)) as { data?: ExpoPushTicket[]; errors?: unknown[] } | null;

      if (!r.ok) {
        const errBody = parsed ? JSON.stringify(parsed).slice(0, 500) : "push_failed";
        batches.push({ ok: false, status: r.status, error: errBody });
        logExpoPush("error", "Expo push HTTP error", {
          httpStatus: r.status,
          chunkSize: chunk.length,
          error: errBody,
          hasAccessToken: !!process.env.EXPO_ACCESS_TOKEN?.trim(),
        });
        continue;
      }

      const tickets = parsed?.data ?? [];
      const summary = tickets.length ? summarizeExpoTickets(tickets) : { ok: 0, error: 0, errorTypes: [], messages: [] };
      batches.push({
        ok: summary.error === 0,
        status: r.status,
        ticketsOk: summary.ok,
        ticketsError: summary.error,
        ticketErrorTypes: summary.errorTypes,
        ...(summary.error > 0 ? { error: summary.errorTypes.join(", ") || "ticket_errors" } : {}),
      });

      logExpoPush(summary.error > 0 ? "error" : "info", "Expo push batch sent", {
        httpStatus: r.status,
        chunkSize: chunk.length,
        ticketsOk: summary.ok,
        ticketsError: summary.error,
        ticketErrorTypes: summary.errorTypes,
        ticketMessages: summary.messages,
        titlePreview: title.slice(0, 40),
      });

      if (tickets.length) {
        await deleteDeviceNotRegisteredTokens(admin, chunk, tickets);
      }
    } catch (e: unknown) {
      Sentry.captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      batches.push({ ok: false, error: msg });
      logExpoPush("error", "Expo push fetch failed", { error: msg, chunkSize: chunk.length });
    }
  }

  return { tokens: deduped.length, batches };
}

function productionPushDeviceQuery(admin: SupabaseClient) {
  return admin
    .from("user_push_devices")
    .select("expo_push_token")
    .eq("push_notifications_enabled", true)
    .in("installation_context", [...PRODUCTION_PUSH_INSTALLATION_CONTEXTS]);
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
  if (!unique.length) {
    logExpoPush("warn", "sendPushToUsers called with no user ids", {});
    return { tokens: 0, batches: [] };
  }

  const tokens: string[] = [];

  for (let i = 0; i < unique.length; i += USER_ID_IN_CHUNK) {
    const slice = unique.slice(i, i + USER_ID_IN_CHUNK);
    const res = await productionPushDeviceQuery(admin).in("user_id", slice);
    if (res.error) {
      logExpoPush("error", "push token lookup failed", {
        lookupError: res.error.message,
        userIdsRequested: unique.length,
      });
      return { tokens: 0, batches: [], lookupError: res.error.message };
    }
    for (const row of res.data || []) {
      const t = (row as { expo_push_token?: unknown }).expo_push_token;
      if (typeof t === "string" && t.length > 10) tokens.push(t);
    }
  }

  logExpoPush("info", "push token lookup", {
    userIdsRequested: unique.length,
    tokensResolved: tokens.length,
    installationContexts: PRODUCTION_PUSH_INSTALLATION_CONTEXTS,
  });

  return sendTokensToExpo(admin, tokens, payload);
}

/**
 * Sends to every stored push token (capped at MAX_TOKEN_QUERY rows).
 */
export async function sendPushToAll(
  admin: SupabaseClient,
  payload: ExpoPushPayload,
): Promise<SendPushResult> {
  const res = await productionPushDeviceQuery(admin).limit(MAX_TOKEN_QUERY);
  if (res.error) {
    logExpoPush("error", "push token lookup failed (sendPushToAll)", { lookupError: res.error.message });
    return { tokens: 0, batches: [], lookupError: res.error.message };
  }
  const tokens = (res.data ?? [])
    .map((r) => (r as { expo_push_token?: unknown }).expo_push_token)
    .filter((t): t is string => typeof t === "string" && t.length > 10);
  return sendTokensToExpo(admin, tokens, payload);
}
