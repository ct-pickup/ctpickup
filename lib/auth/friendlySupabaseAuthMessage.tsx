import type { ReactNode } from "react";
import { SupportEmailLink } from "@/components/SupportEmailLink";

/**
 * Clearer copy for known Supabase Auth errors (OTP sign-in / sign-up).
 */
export function friendlySupabaseAuthMessage(raw: string): ReactNode {
  if (/database error saving new user/i.test(raw)) {
    return (
      <>
        We couldn’t finish creating your account because saving your profile in our database
        failed when your account was first created (before the signup form). That is usually a
        server-side database or migration issue, not something you did wrong. Please try again in
        a few minutes, or email{" "}
        <SupportEmailLink className="font-medium text-white underline underline-offset-2 hover:text-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm" />{" "}
        if it keeps happening.
      </>
    );
  }
  return raw;
}
