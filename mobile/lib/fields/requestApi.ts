import { siteOrigin } from "@/lib/env";

export type SubmitRequestInput = { venue_key: string; requested_date: string; start_time: string; players: number; duration_hours: number };
export type SubmitRequestResult =
  | { ok: true; id: string }
  | { ok: false; code: "duplicate" | "rate_limited" | "not_found" | "invalid" | "network" | "error"; message: string };

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/** Saves the request and tells the admins. Never emails a school: that part is done by hand. */
export async function submitFieldRequest(token: string, input: SubmitRequestInput): Promise<SubmitRequestResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, code: "network", message: NETWORK_MESSAGE };
  try {
    const r = await fetch(`${origin}/api/fields/requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string; code?: string } | null;
    if (r.ok && j?.ok && j.id) return { ok: true, id: j.id };
    const message = j?.error ?? "We couldn't send your request. Please try again.";
    if (r.status === 409) return { ok: false, code: "duplicate", message };
    if (r.status === 429) return { ok: false, code: "rate_limited", message };
    if (r.status === 404) return { ok: false, code: "not_found", message };
    if (r.status === 400) return { ok: false, code: "invalid", message };
    return { ok: false, code: "error", message };
  } catch {
    return { ok: false, code: "network", message: NETWORK_MESSAGE };
  }
}
