/** Query param on `/signup` — required so signup is only for pickup or tournament intent. */
export const SIGNUP_INTENT_QUERY = "intent";

/** Optional same-origin return path after successful signup (e.g. esports registration). */
export const SIGNUP_NEXT_QUERY = "next";

/**
 * Persistent client-side marker that this browser has successfully completed signup at least once.
 * Used for guest UX (e.g. show “Log in” instead of “Sign up” on return visits while logged out).
 */
export const HAS_EVER_SIGNED_UP_KEY = "ctpickup_has_ever_signed_up_v1";

export type SignupIntent = "pickup" | "tournament";

export function isSignupIntent(value: string | null | undefined): value is SignupIntent {
  return value === "pickup" || value === "tournament";
}

export function signupUrlForIntent(intent: SignupIntent): string {
  return `/signup?${SIGNUP_INTENT_QUERY}=${intent}`;
}

/** When set on `/signup`, the user was sent from a protected nav tab before ever signing up on this browser. */
export const SIGNUP_GATE_QUERY = "gate";
export const SIGNUP_GATE_VALUE_SIGNUP_FIRST = "signup-required";

export function signupUrlForProtectedNavFirstVisit(intent: SignupIntent): string {
  const u = new URL(signupUrlForIntent(intent), "http://local");
  u.searchParams.set(SIGNUP_GATE_QUERY, SIGNUP_GATE_VALUE_SIGNUP_FIRST);
  return `${u.pathname}${u.search}`;
}

/**
 * Maps protected hub paths to signup intent. Esports shares the tournament signup flow (EA / online events).
 */
export function signupIntentForProtectedPath(href: string): SignupIntent | null {
  const pathOnly = (href.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (pathOnly === "/pickup" || pathOnly.startsWith("/pickup/")) return "pickup";
  if (pathOnly === "/tournament" || pathOnly.startsWith("/tournament/")) return "tournament";
  if (pathOnly === "/esports" || pathOnly.startsWith("/esports/")) return "tournament";
  return null;
}

export function readHasEverSignedUpBrowser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HAS_EVER_SIGNED_UP_KEY) === "1";
  } catch {
    return false;
  }
}

export function signupCopyForIntent(intent: SignupIntent): {
  title: string;
  lead: string;
  finishCta: string;
} {
  if (intent === "pickup") {
    return {
      title: "Join pickup",
      lead: "Create an account to join competitive pickup games and manage your invites.",
      finishCta: "Finish and open hub",
    };
  }
  return {
    title: "Join tournaments",
    lead: "Create an account to enter tournaments and EA SPORTS FC online events.",
    finishCta: "Finish and open hub",
  };
}
