import { siteOrigin } from "@/lib/env";

export type PreferenceResult = { ok: true; enabled: boolean } | { ok: false };

async function call(token: string, method: "GET" | "POST", body?: { enabled: boolean }): Promise<PreferenceResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false };
  try {
    const r = await fetch(`${origin}/api/account/analytics-preference`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as { enabled?: unknown } | null;
    return r.ok && typeof j?.enabled === "boolean" ? { ok: true, enabled: j.enabled } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const fetchAnalyticsPreference = (token: string) => call(token, "GET");
export const saveAnalyticsPreference = (token: string, enabled: boolean) => call(token, "POST", { enabled });
