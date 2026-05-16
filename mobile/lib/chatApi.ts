import { siteOrigin } from "@/lib/env";

export async function postChatMessageViaApi(
  accessToken: string,
  roomId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing EXPO_PUBLIC_SITE_URL" };
  let r: Response;
  try {
    r = await fetch(`${origin}/api/chat/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room_id: roomId, body }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Network error" };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg =
      j && typeof j.error === "string" && j.error.trim()
        ? j.error.trim()
        : r.statusText?.trim()
          ? `HTTP ${r.status} ${r.statusText}`
          : `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export type ChatReportReason = "harassment" | "spam" | "inappropriate" | "other" | "impersonation";

export async function postChatReportViaApi(
  accessToken: string,
  messageId: string,
  reason: ChatReportReason,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing EXPO_PUBLIC_SITE_URL" };
  let r: Response;
  try {
    r = await fetch(`${origin}/api/chat/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message_id: messageId, reason }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Network error" };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg =
      j && typeof j.error === "string" && j.error.trim()
        ? j.error.trim()
        : `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

/** Profile report (no chat message); `reason` is the label shown in the report UI. */
export async function postPlayerProfileReportViaApi(
  accessToken: string,
  reportedUserId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing EXPO_PUBLIC_SITE_URL" };
  let r: Response;
  try {
    r = await fetch(`${origin}/api/chat/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reported_user_id: reportedUserId,
        reason,
        message_id: null,
        room_id: null,
      }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Network error" };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg =
      j && typeof j.error === "string" && j.error.trim()
        ? j.error.trim()
        : `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export type ChatReactionGroup = { emoji: string; count: number; reacted_by_me: boolean };

export async function postChatReactionToggleViaApi(
  accessToken: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: true; reactions: ChatReactionGroup[] } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing EXPO_PUBLIC_SITE_URL" };
  let r: Response;
  try {
    r = await fetch(`${origin}/api/chat/reaction`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message_id: messageId, emoji }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Network error" };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg =
      j && typeof j.error === "string" && j.error.trim()
        ? j.error.trim()
        : `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  const reactions = j?.reactions;
  if (!Array.isArray(reactions)) return { ok: false, error: "Invalid response" };
  const parsed: ChatReactionGroup[] = [];
  for (const item of reactions) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const emojiStr = typeof o.emoji === "string" ? o.emoji : "";
    const count = typeof o.count === "number" ? o.count : Number(o.count);
    if (!emojiStr || !Number.isFinite(count)) continue;
    parsed.push({
      emoji: emojiStr,
      count,
      reacted_by_me: o.reacted_by_me === true,
    });
  }
  return { ok: true, reactions: parsed };
}

export async function postChatBlockViaApi(
  accessToken: string,
  blockedUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "Missing EXPO_PUBLIC_SITE_URL" };
  let r: Response;
  try {
    r = await fetch(`${origin}/api/chat/block`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ blocked_user_id: blockedUserId }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Network error" };
  }
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg =
      j && typeof j.error === "string" && j.error.trim()
        ? j.error.trim()
        : `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}
