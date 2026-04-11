/**
 * Clearer copy for known Supabase Auth errors (OTP sign-in / sign-up).
 */
export function friendlySupabaseAuthMessage(raw: string): string {
  if (/database error saving new user/i.test(raw)) {
    return "We couldn’t finish setting up your account (a database step failed). Please try again, or contact support if this keeps happening.";
  }
  return raw;
}
