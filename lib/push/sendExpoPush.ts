import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCTION_PUSH_INSTALLATION_CONTEXTS } from "@/lib/push/registerUserPushDevice";
import { randomUUID } from "node:crypto";
import { recordEvents, type NewEvent } from "@/lib/analytics/events";
import { applyPushPolicy, pushCategoryFor, type PushCategory } from "@/lib/push/pushPolicy";

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

/** How a send relates to the player's notification settings. */
export type PushSendOpts = {
  /** A waitlist spot within 2 hours of kickoff, or a cancellation for a game today: skips quiet hours (never a switched-off category). */
  urgent?: boolean;
  /** Overrides the category worked out from payload.data.kind. */
  category?: PushCategory;
};

export type SendPushResult = {
  tokens: number;
  /** Players left out because of their category switches or quiet hours. */
  suppressed?: number;
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

type PushDeviceQueryOpts = {
  /** When true, only devices whose user opted into marketing/announcement pushes. */
  marketingOnly?: boolean;
};

function productionPushDeviceQuery(admin: SupabaseClient, opts?: PushDeviceQueryOpts) {
  // Include legacy NULL rows (registered before installation_context was persisted).
  // New registrations must set standalone/bare; storeClient is never stored.
  let q = admin
    .from("user_push_devices")
    .select("user_id, expo_push_token, installation_context")
    .eq("push_notifications_enabled", true)
    .or(
      `installation_context.in.(${PRODUCTION_PUSH_INSTALLATION_CONTEXTS.join(",")}),installation_context.is.null`,
    );
  if (opts?.marketingOnly) {
    q = q.eq("marketing_push_enabled", true);
  }
  return q;
}

/** Keeps only user ids with profiles.marketing_push_enabled = true (for marketing sends). */
export async function filterMarketingOptInUserIds(
  admin: SupabaseClient,
  userIds: string[],
): Promise<{ userIds: string[]; lookupError?: string }> {
  const unique = Array.from(new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (!unique.length) return { userIds: [] };

  const out: string[] = [];
  for (let i = 0; i < unique.length; i += USER_ID_IN_CHUNK) {
    const slice = unique.slice(i, i + USER_ID_IN_CHUNK);
    const res = await admin
      .from("profiles")
      .select("id")
      .in("id", slice)
      .eq("marketing_push_enabled", true);
    if (res.error) {
      return { userIds: [], lookupError: res.error.message };
    }
    for (const row of res.data ?? []) {
      const id = (row as { id?: string }).id;
      if (typeof id === "string" && id) out.push(id);
    }
  }
  return { userIds: out };
}

/**
 * Applies the players' notification settings (category switches, quiet hours) and returns who may be pushed now.
 * Used by every send path below, so no caller can skip the settings.
 */
async function allowedByPolicy(admin: SupabaseClient, userIds: string[], payload: ExpoPushPayload, opts?: PushSendOpts): Promise<{ allowed: string[]; suppressed: number }> {
  try {
    const category = opts?.category ?? pushCategoryFor(payload.data);
    const res = await applyPushPolicy(admin, userIds, category, { urgent: opts?.urgent === true });
    if (res.suppressed.length) {
      logExpoPush("info", "push suppressed by player settings", {
        category,
        suppressed: res.suppressed.length,
        categoryOff: res.suppressed.filter((s) => s.reason === "category_off").length,
        quietHours: res.suppressed.filter((s) => s.reason === "quiet_hours").length,
      });
    }
    return { allowed: res.allowed, suppressed: res.suppressed.length };
  } catch (e) {
    // A settings lookup failure must not silence every push.
    logExpoPush("warn", "push policy lookup failed; sending without it", { error: e instanceof Error ? e.message : String(e) });
    return { allowed: userIds, suppressed: 0 };
  }
}

/**
 * Looks up Expo tokens for the given users and sends notifications in batches of 100.
 * Players who switched the push's category off, or are in their quiet hours, are skipped (see lib/push/pushPolicy.ts).
 */
export async function sendPushToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: ExpoPushPayload,
  opts?: PushSendOpts,
): Promise<SendPushResult> {
  const requested = Array.from(new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (!requested.length) {
    logExpoPush("warn", "sendPushToUsers called with no user ids", {});
    return { tokens: 0, batches: [] };
  }
  const policy = await allowedByPolicy(admin, requested, payload, opts);
  const unique = policy.allowed;
  if (!unique.length) return { tokens: 0, batches: [], suppressed: policy.suppressed };

  const tokens: string[] = [];
  let legacyNullContextRows = 0;
  const reached = new Set<string>();
  let productionContextRows = 0;

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
      const ctx = (row as { installation_context?: unknown }).installation_context;
      if (ctx === null || ctx === undefined) legacyNullContextRows += 1;
      else productionContextRows += 1;
      const t = (row as { expo_push_token?: unknown }).expo_push_token;
      if (typeof t === "string" && t.length > 10) {
        tokens.push(t);
        const uid = (row as { user_id?: unknown }).user_id;
        if (typeof uid === "string") reached.add(uid);
      }
    }
  }

  const lookupLevel = tokens.length === 0 ? "error" : legacyNullContextRows > 0 ? "warn" : "info";
  logExpoPush(lookupLevel, "push token lookup", {
    userIdsRequested: unique.length,
    tokensResolved: tokens.length,
    productionContextRows,
    legacyNullContextRows,
    installationContexts: PRODUCTION_PUSH_INSTALLATION_CONTEXTS,
  });

  // push_id lets the app say which push was opened (push_opened) without any other identifier.
  const pushId = randomUUID();
  const tagged: ExpoPushPayload = { ...payload, data: { ...(payload.data ?? {}), push_id: pushId } };
  const sent = await sendTokensToExpo(admin, tokens, tagged);
  if (sent.batches.some((b) => b.ok || (b.ticketsOk ?? 0) > 0)) {
    await recordPushSent(admin, [...reached], payload, pushId);
  }
  return policy.suppressed ? { ...sent, suppressed: policy.suppressed } : sent;
}

/**
 * Marketing/announcement pushes: requires operational push on AND marketing opt-in.
 */
export async function sendMarketingPushToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: ExpoPushPayload,
  opts?: PushSendOpts,
): Promise<SendPushResult> {
  const filtered = await filterMarketingOptInUserIds(admin, userIds);
  if (filtered.lookupError) {
    return { tokens: 0, batches: [], lookupError: filtered.lookupError };
  }
  return sendPushToUsers(admin, filtered.userIds, payload, { ...opts, category: "marketing" });
}

/**
 * Sends to every stored push token (capped at MAX_TOKEN_QUERY rows).
 */
export async function sendPushToAll(
  admin: SupabaseClient,
  payload: ExpoPushPayload,
  opts?: PushSendOpts,
): Promise<SendPushResult> {
  const res = await productionPushDeviceQuery(admin).limit(MAX_TOKEN_QUERY);
  if (res.error) {
    logExpoPush("error", "push token lookup failed (sendPushToAll)", { lookupError: res.error.message });
    return { tokens: 0, batches: [], lookupError: res.error.message };
  }
  const rows = (res.data ?? []) as { user_id?: unknown; expo_push_token?: unknown }[];
  const policy = await allowedByPolicy(admin, Array.from(new Set(rows.map((r) => String(r.user_id ?? "")).filter(Boolean))), payload, opts);
  const ok = new Set(policy.allowed);
  const tokens = rows
    .filter((r) => ok.has(String(r.user_id ?? "")))
    .map((r) => r.expo_push_token)
    .filter((t): t is string => typeof t === "string" && t.length > 10);
  const sent = await sendTokensToExpo(admin, tokens, payload);
  return policy.suppressed ? { ...sent, suppressed: policy.suppressed } : sent;
}

/**
 * Broadcast marketing/announcement push to opted-in devices only.
 */
export async function sendMarketingPushToAll(
  admin: SupabaseClient,
  payload: ExpoPushPayload,
  opts?: { excludeUserIds?: ReadonlySet<string> } & PushSendOpts,
): Promise<SendPushResult> {
  const res = await productionPushDeviceQuery(admin, { marketingOnly: true }).limit(MAX_TOKEN_QUERY);
  if (res.error) {
    logExpoPush("error", "push token lookup failed (sendMarketingPushToAll)", {
      lookupError: res.error.message,
    });
    return { tokens: 0, batches: [], lookupError: res.error.message };
  }
  const excluded = opts?.excludeUserIds;
  const rows = ((res.data ?? []) as { user_id?: unknown; expo_push_token?: unknown }[]).filter(
    (r) => !excluded?.size || !excluded.has(String(r.user_id ?? "")),
  );
  const policy = await allowedByPolicy(admin, Array.from(new Set(rows.map((r) => String(r.user_id ?? "")).filter(Boolean))), payload, { ...opts, category: "marketing" });
  const ok = new Set(policy.allowed);
  const tokens = rows
    .filter((r) => ok.has(String(r.user_id ?? "")))
    .map((r) => r.expo_push_token)
    .filter((t): t is string => typeof t === "string" && t.length > 10);
  const sent = await sendTokensToExpo(admin, tokens, payload);
  return policy.suppressed ? { ...sent, suppressed: policy.suppressed } : sent;
}

/** push_sent per player reached. Analytics only: never throws. */
async function recordPushSent(admin: SupabaseClient, userIds: string[], payload: ExpoPushPayload, pushId: string): Promise<void> {
  const k = payload.data?.kind;
  const kind = typeof k === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(k) ? k : "other";
  const category = pushCategoryFor(payload.data);
  const events: NewEvent[] = userIds.map((userId) => ({
    key: `push_sent:${pushId}:${userId}`,
    name: "push_sent",
    userId,
    source: "server",
    properties: { push_id: pushId, kind, category },
  }));
  await recordEvents(admin, events);
}
