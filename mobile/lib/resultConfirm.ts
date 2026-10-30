import { siteOrigin } from "@/lib/env";

import type { ConfirmState } from "@/lib/resultConfirmCore";

export * from "@/lib/resultConfirmCore";

async function call(token: string, method: "GET" | "POST", runId: string): Promise<{ ok: true; state: ConfirmState } | { ok: false; error: string }> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "We couldn’t reach the server." };
  try {
    const r = await fetch(`${origin}/api/sessions/result/confirm${method === "GET" ? `?run_id=${encodeURIComponent(runId)}` : ""}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify({ run_id: runId }) : undefined,
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as (ConfirmState & { error?: string }) | null;
    if (!r.ok || !j) return { ok: false, error: j?.error === "feature_off" ? "feature_off" : (j?.error ?? "Something went wrong. Try again.") };
    return { ok: true, state: j };
  } catch {
    return { ok: false, error: "We couldn’t reach the server." };
  }
}

export const fetchConfirmState = (token: string, runId: string) => call(token, "GET", runId);
export const confirmScore = (token: string, runId: string) => call(token, "POST", runId);

