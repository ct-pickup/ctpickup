/** Fields paid plans: what each plan includes, and how a sent request is classified. Shared by the app and the server.
 *  The prices and included counts must match the plan_catalog seed in migration 20261015000000_plans.sql. */

export type PlanId = "scout" | "email" | "concierge";
export const PLAN_IDS: PlanId[] = ["scout", "email", "concierge"];

export type PlanInfo = {
  id: PlanId;
  name: string;
  priceCents: number;
  /** Requests included each month. */
  monthlyRequests: number;
  /** Price of each request beyond the included ones, or null when the plan includes none. */
  extraCents: number | null;
  tagline: string;
  features: string[];
};

export const PLANS: Record<PlanId, PlanInfo> = {
  scout: {
    id: "scout",
    name: "Scout",
    priceCents: 599,
    monthlyRequests: 0,
    extraCents: null,
    tagline: "Know the moment a field opens up.",
    features: ["Alerts when a slot opens", "Saved fields", "Requests are not included"],
  },
  email: {
    id: "email",
    name: "Email",
    priceCents: 1099,
    monthlyRequests: 3,
    extraCents: 300,
    tagline: "We email the venue for you.",
    features: ["Everything in Scout", "3 requests a month", "We email the venue for you"],
  },
  concierge: {
    id: "concierge",
    name: "Concierge",
    priceCents: 2999,
    monthlyRequests: 4,
    extraCents: 800,
    tagline: "We handle it from start to finish.",
    features: ["Everything in Scout", "4 requests a month", "We call, handle permit forms, follow up and confirm"],
  },
};

export const FIRST_REQUEST_FREE_COPY = "Your first request is free.";
export const SEASON_COPY = "A whole season at one field counts as one request.";
export const CREDIT_COPY = "If a venue doesn’t reply in 7 days, you get the request back as credit.";

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as string[]).includes(v);
}

export function formatPlanPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function extraRequestLine(p: PlanInfo): string | null {
  return p.extraCents == null ? null : `Extra requests ${formatPlanPrice(p.extraCents).replace(/\.00$/, "")} each`;
}

export type RequestKind = "free" | "included" | "extra";

/**
 * The rule the database applies when a request is sent (record_plan_request_usage): the one free request first, then the
 * plan's included requests for the period, then extras. A player with no plan has nothing included, so after the free request
 * every request is an extra. Never blocks a request.
 */
export function classifyUsage(args: { freeUsed: boolean; included: number; used: number }): RequestKind {
  if (!args.freeUsed) return "free";
  return args.used < args.included ? "included" : "extra";
}

/** One row of my_plan_status(). */
export type PlanStatus = {
  plan: PlanId | null;
  status: string | null;
  current_period_end: string | null;
  monthly_requests: number;
  requests_used: number;
  extra_requests_used: number;
  requests_left: number;
  free_request_used: boolean | null;
  period_start: string | null;
};

/** The "Your plan" line: title and detail. No plan still tells the player about the free request. */
export function yourPlanLine(s: PlanStatus | null): { title: string; detail: string } {
  const freeLeft = s?.free_request_used !== true;
  const free = freeLeft ? "Your first request is free." : "Your free request is used.";
  if (!s || !s.plan) return { title: "No plan", detail: free };
  const info = PLANS[s.plan];
  const left = info.monthlyRequests === 0 ? "No requests included" : `${s.requests_left} of ${s.monthly_requests} requests left this month`;
  return { title: `${info.name} plan`, detail: `${left}. ${free}` };
}
