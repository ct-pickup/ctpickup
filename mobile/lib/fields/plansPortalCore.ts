export type PortalResult = { ok: true; url: string } | { ok: false; code: "no_plan" | "not_available" | "network" | "error"; message: string };

export const PORTAL_NETWORK_MESSAGE = "We couldn’t reach the server. Check your connection and try again.";
export const PORTAL_ERROR_MESSAGE = "We couldn’t open your plan settings. Please try again in a moment.";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Asks the server for the Stripe billing portal link and turns every outcome into a result the screen can show. */
export async function requestPortalUrl(fetchFn: FetchLike, origin: string | null | undefined, token: string): Promise<PortalResult> {
  if (!origin) return { ok: false, code: "network", message: PORTAL_NETWORK_MESSAGE };
  try {
    const r = await fetchFn(`${origin}/api/plans/portal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
    if (r.ok && j?.ok && typeof j.url === "string" && j.url) return { ok: true, url: j.url };
    if (r.status === 404) return { ok: false, code: "no_plan", message: "We couldn’t find an active Concierge plan on your account." };
    if (r.status === 403) return { ok: false, code: "not_available", message: "Plans aren’t available right now." };
    const message = typeof j?.error === "string" && j.error && !/^[a-z_]+$/.test(j.error) ? j.error : PORTAL_ERROR_MESSAGE;
    return { ok: false, code: "error", message };
  } catch {
    return { ok: false, code: "network", message: PORTAL_NETWORK_MESSAGE };
  }
}
