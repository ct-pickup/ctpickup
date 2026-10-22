/**
 * Fields plans (board 11, "Plans, version 2"). THIS FILE IS THE ONE PLACE FOR PRICES AND PLAN COPY.
 * To change a price: change `priceCents` here AND create a new Price in Stripe, then put its id in the matching env var
 * (STRIPE_PRICE_SEASON, STRIPE_PRICE_CONCIERGE). What a player is charged comes from the Stripe Price; what the app shows
 * comes from here. Shared by the app and the server.
 *
 * Included requests per month also live in the plan_catalog table (migration 20261015000000). If you change
 * `monthlyRequests` for Concierge, update that row too.
 */

export type PlanId = "free" | "season" | "concierge";
/** The order the Plans screen shows them in: the season card is highlighted at the top. */
export const PLAN_IDS: PlanId[] = ["season", "concierge", "free"];
/** Plans that go through Stripe Checkout. */
export const CHECKOUT_PLAN_IDS = ["season", "concierge"] as const;
export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number];

export type PlanInfo = {
  id: PlanId;
  name: string;
  priceCents: number;
  /** free: nothing to pay. one_time: a single payment. monthly: a subscription. */
  billing: "free" | "one_time" | "monthly";
  /** Requests included each month (Concierge only). */
  monthlyRequests: number;
  /** Price of each request beyond the included ones, or null when there are none. */
  extraCents: number | null;
  tagline: string;
  features: string[];
  cta: string;
};

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: "free",
    name: "Do it yourself",
    priceCents: 0,
    billing: "free",
    monthlyRequests: 0,
    extraCents: null,
    tagline: "The app drafts the email. You send it.",
    features: ["We draft the email to the venue", "You send it and follow up yourself"],
    cta: "Your plan",
  },
  season: {
    id: "season",
    name: "Book my season",
    priceCents: 3900,
    billing: "one_time",
    monthlyRequests: 0,
    extraCents: null,
    tagline: "One field, the same time every week, for a whole season.",
    features: ["One field, same weekday and time every week", "We contact the venue, handle any permit and confirm it", "Counts as one request, however many weeks"],
    cta: "Book my season",
  },
  concierge: {
    id: "concierge",
    name: "Concierge",
    priceCents: 2999,
    billing: "monthly",
    monthlyRequests: 4,
    extraCents: 800,
    tagline: "We handle it from start to finish.",
    features: ["4 requests a month", "We email, call, fill out permit forms, follow up and confirm", "Cancel any time"],
    cta: "Choose Concierge",
  },
};

/** Season length choices on the Book my season screen, and the longest the server accepts. */
export const SEASON_WEEK_OPTIONS = [4, 6, 8, 10, 12, 16] as const;
export const SEASON_DEFAULT_WEEKS = 10;
export const SEASON_MAX_WEEKS = 20;

export const FIRST_REQUEST_FREE_COPY = "Your first request is free.";
export const CREDIT_COPY = "If a venue doesn’t reply in 7 days, you get the request back as credit.";
export const FIELD_FEES_COPY = "Field fees are not included.";
export const SEASON_COUNTS_COPY = "A season counts as one request, however many weeks.";

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as string[]).includes(v);
}

export function isCheckoutPlanId(v: unknown): v is CheckoutPlanId {
  return typeof v === "string" && (CHECKOUT_PLAN_IDS as readonly string[]).includes(v);
}

/** "$39", "$29.99" or "Free". Whole-dollar prices drop the cents. */
export function formatPlanPrice(cents: number): string {
  if (cents === 0) return "Free";
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** "one-time", "/month" or "". */
export function planPriceSuffix(p: PlanInfo): string {
  return p.billing === "one_time" ? " one-time" : p.billing === "monthly" ? "/month" : "";
}

export function extraRequestLine(p: PlanInfo): string | null {
  return p.extraCents == null ? null : `Extra requests ${formatPlanPrice(p.extraCents)} each`;
}

export type RequestKind = "free" | "included" | "extra" | "season";

/**
 * The rule the database applies when a single request is sent (record_plan_request_usage): the one free request first, then
 * Concierge's included requests for the period, then extras. A player without Concierge has nothing included, so after the
 * free request each request is flagged an extra. Never blocks a request. A paid season is not classified here: the server
 * flags it "season" when payment completes, and it does not use up the free or included requests.
 */
export function classifyUsage(args: { freeUsed: boolean; included: number; used: number }): Exclude<RequestKind, "season"> {
  if (!args.freeUsed) return "free";
  return args.used < args.included ? "included" : "extra";
}

/** One row of my_plan_status(). */
export type PlanStatus = {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  monthly_requests: number;
  requests_used: number;
  extra_requests_used: number;
  requests_left: number;
  free_request_used: boolean | null;
  period_start: string | null;
};

/** The "Your plan" line. Do it yourself is the default plan. Booked seasons are mentioned when there are any. */
export function yourPlanLine(s: PlanStatus | null, seasonsBooked = 0): { title: string; detail: string } {
  const free = s?.free_request_used !== true ? "Your first request is free." : "Your free request is used.";
  const seasons = seasonsBooked > 0 ? ` ${seasonsBooked} season${seasonsBooked === 1 ? "" : "s"} booked.` : "";
  if (s?.plan === "concierge") {
    return { title: "Concierge", detail: `${s.requests_left} of ${s.monthly_requests} requests left this month. ${free}${seasons}` };
  }
  return { title: PLANS.free.name, detail: `${PLANS.free.tagline} ${free}${seasons}`.trim() };
}
