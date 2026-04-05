/**
 * Defense in depth: webhook POSTs are signed, but verifying AccountSid matches this deployment
 * catches misconfigured Twilio URLs or wrong credentials copied into env.
 */
export function verifyTwilioWebhookAccountSid(
  params: Record<string, string>,
  expectedAccountSid: string | null,
): { ok: true } | { ok: false; reason: string } {
  const got = params.AccountSid?.trim();
  if (!got) {
    return { ok: false, reason: "Missing AccountSid on webhook payload." };
  }

  if (!/^AC[a-z0-9]{32}$/i.test(got)) {
    return { ok: false, reason: "Malformed AccountSid." };
  }

  if (expectedAccountSid && got !== expectedAccountSid) {
    return { ok: false, reason: "AccountSid does not match TWILIO_ACCOUNT_SID for this app." };
  }

  return { ok: true };
}
