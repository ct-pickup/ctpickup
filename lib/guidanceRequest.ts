/**
 * Player development / guidance requests — shapes for API, DB, and future mentorship flows.
 */

export const GUIDANCE_PLANS = ["foundation", "development", "elite"] as const;
export type GuidancePlan = (typeof GUIDANCE_PLANS)[number];

export type GuidanceRequestStatus = "pending" | "assigned" | "completed";

/** Domain model for persistence and future mentor assignment / chat. */
export type GuidanceRequestRecord = {
  id: string;
  userId: string | null;
  plan: GuidancePlan;
  message: string;
  status: GuidanceRequestStatus;
  createdAt: string;
  submitterName?: string | null;
  submitterEmail?: string | null;
  profileTierSnapshot?: string | null;
  sportFocus?: string | null;
};

/** Payload accepted by POST /api/guidance/request */
export type GuidanceRequestSubmitBody = {
  plan: GuidancePlan;
  message: string;
  sport_focus?: string | null;
};

const MAX_MESSAGE_LEN = 5000;
const MAX_SPORT_FOCUS_LEN = 280;

export function validateSportFocus(value: unknown): string | null {
  const t = String(value ?? "").trim();
  if (t.length > MAX_SPORT_FOCUS_LEN) {
    return `Sport / focus must be at most ${MAX_SPORT_FOCUS_LEN} characters.`;
  }
  return null;
}

export function parseGuidancePlan(value: unknown): GuidancePlan | null {
  const s = String(value || "").toLowerCase().trim();
  return GUIDANCE_PLANS.includes(s as GuidancePlan)
    ? (s as GuidancePlan)
    : null;
}

export function validateGuidanceMessage(message: unknown): string | null {
  const t = String(message ?? "").trim();
  if (!t) return "Please describe what you need help with.";
  if (t.length > MAX_MESSAGE_LEN) return `Message must be at most ${MAX_MESSAGE_LEN} characters.`;
  return null;
}

export function isValidGuidanceSubmit(
  body: unknown
): body is GuidanceRequestSubmitBody {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const plan = parseGuidancePlan(o.plan);
  if (!plan) return false;
  if (validateGuidanceMessage(o.message) !== null) return false;
  return true;
}
