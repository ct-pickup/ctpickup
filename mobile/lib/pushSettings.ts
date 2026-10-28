import { siteOrigin } from "@/lib/env";
import { parseSettings, type PushCategoryKey, type PushSettings } from "@/lib/pushSettingsCore";

export * from "@/lib/pushSettingsCore";

export type SettingsResult = { ok: true; settings: PushSettings } | { ok: false; status: number; error: string };

async function call(token: string, method: "GET" | "POST", body?: unknown): Promise<SettingsResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, status: 0, error: "We couldn’t reach the server." };
  try {
    const r = await fetch(`${origin}/api/mobile/push-settings`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as { settings?: unknown; error?: string } | null;
    if (!r.ok) return { ok: false, status: r.status, error: j?.error === "feature_off" ? "feature_off" : (j?.error ?? "We couldn’t save that.") };
    return { ok: true, settings: parseSettings(j?.settings) };
  } catch {
    return { ok: false, status: 0, error: "We couldn’t reach the server." };
  }
}

export const fetchPushSettings = (token: string) => call(token, "GET");
export const savePushSettings = (token: string, update: { categories?: Partial<Record<PushCategoryKey, boolean>>; quiet?: { enabled?: boolean; start?: number; end?: number; timezone?: string } }) => call(token, "POST", update);
