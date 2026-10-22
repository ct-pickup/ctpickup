import { siteOrigin } from "@/lib/env";

export type CheckoutBody =
  | { plan: "concierge" }
  | { plan: "season"; venue_key: string; weekday: number; start_time: string; duration_hours: number; weeks: number; players?: number };

export type CheckoutResult = { ok: true; url: string } | { ok: false; code: "already_subscribed" | "not_available" | "network" | "error"; message: string };

/** Asks the server for a Stripe Checkout link (test mode). The player pays in the browser sheet, not in the app. */
export async function startPlanCheckout(token: string, body: CheckoutBody): Promise<CheckoutResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, code: "network", message: "We couldn’t reach the server." };
  try {
    const r = await fetch(`${origin}/api/plans/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string; code?: string } | null;
    if (r.ok && j?.ok && j.url) return { ok: true, url: j.url };
    if (r.status === 403 && j?.error === "feature_off") return { ok: false, code: "not_available", message: "Plans aren’t available yet." };
    const message = j?.error ?? "We couldn’t start checkout. Please try again.";
    if (r.status === 409) return { ok: false, code: "already_subscribed", message };
    if (r.status === 403) return { ok: false, code: "not_available", message };
    return { ok: false, code: "error", message };
  } catch {
    return { ok: false, code: "network", message: "We couldn’t reach the server." };
  }
}
