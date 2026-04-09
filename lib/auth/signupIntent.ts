/** Query param on `/signup` — required so signup is only for pickup or tournament intent. */
export const SIGNUP_INTENT_QUERY = "intent";

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
