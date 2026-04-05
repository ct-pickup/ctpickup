/**
 * Player development plans — pricing and copy (edit here).
 * Update `GUIDANCE_PRICE_USD` when published prices change.
 */

import type { GuidancePlan } from "@/lib/guidanceRequest";

/** Editable USD prices (whole dollars). */
export const GUIDANCE_PRICE_USD: Record<GuidancePlan, number> = {
  foundation: 49,
  development: 149,
  elite: 299,
};

export function formatGuidancePriceUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

export type GuidancePlanDefinition = {
  key: GuidancePlan;
  title: string;
  /** Short premium positioning line */
  description: string;
  includes: string[];
  priceUsd: number;
};

function price(plan: GuidancePlan): number {
  return GUIDANCE_PRICE_USD[plan];
}

export const GUIDANCE_PLAN_DEFINITIONS: GuidancePlanDefinition[] = [
  {
    key: "foundation",
    title: "Foundation",
    priceUsd: price("foundation"),
    description:
      "A sharp read on where you stand today and a concrete map for what to do next — grounded in how coaches and programs actually operate.",
    includes: [
      "Player evaluation — strengths, gaps, and how you present on the field",
      "Coach insight — what tends to matter in real rooms, not generic checklists",
      "Program / school style breakdown — fit, expectations, and how to read the landscape",
      "Writing guidance — outreach, follow-ups, and tone that sounds like you",
      "Clear next-step roadmap — prioritized actions you can execute immediately",
    ],
  },
  {
    key: "development",
    title: "Development",
    priceUsd: price("development"),
    description:
      "Structure your week around growth: technical priorities, habits, and tracking so progress is visible in games and in the classroom.",
    includes: [
      "Everything in Foundation",
      "Personalized improvement plan — strengths/weaknesses breakdown, technical priorities, tactical and decision-making targets, academic and athletic focus areas, and a clearer weekly action plan",
      "Routine creation — training and habit design that fits your schedule",
      "Performance tracking for academics and sport — simple systems so you see trends, not guesses",
      "Game and decision-making guidance — film mindset, in-game reads, and how to self-correct",
      "Discounted access to partnered player coaches when you want extra reps with someone who trains at a high level",
    ],
  },
  {
    key: "elite",
    title: "Elite",
    priceUsd: price("elite"),
    description:
      "Full support toward your ceiling: aligned mentor match, mental edge, and ongoing iteration as you level up.",
    includes: [
      "Everything in Development",
      "One-on-one guidance with a player or athlete aligned with your goals and needs",
      "Advanced mental and psychological approach — pressure, confidence, and consistency under load",
      "Personalized roadmap — milestones, checkpoints, and what “next level” means for you",
      "Ongoing feedback and adjustments as you evolve",
      "15% off when working with partnered player coaches — stacked on the Development-tier coach benefit where applicable",
    ],
  },
];

export function getGuidancePlanDefinition(
  key: GuidancePlan
): GuidancePlanDefinition | undefined {
  return GUIDANCE_PLAN_DEFINITIONS.find((p) => p.key === key);
}
