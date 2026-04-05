/**
 * Twilio environment — server-only. Supports TWILIO_PHONE_NUMBER with legacy TWILIO_FROM_NUMBER fallback.
 */

export const TWILIO_ENV_KEYS = {
  accountSid: "TWILIO_ACCOUNT_SID",
  authToken: "TWILIO_AUTH_TOKEN",
  phoneNumber: "TWILIO_PHONE_NUMBER",
  legacyFrom: "TWILIO_FROM_NUMBER",
  messagingServiceSid: "TWILIO_MESSAGING_SERVICE_SID",
} as const;

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  /** Sender: either phone or messaging service must be configured for outbound. */
  phoneNumber: string | null;
  messagingServiceSid: string | null;
};

export type TwilioEnvReadResult =
  | { ok: true; credentials: TwilioCredentials }
  | { ok: false; missing: string[] };

function pickTrimmed(name: string): string | null {
  const v = process.env[name];
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

/** Inbound/status webhooks: auth token for signatures; optional AccountSid for payload checks. */
export function readTwilioWebhookEnv():
  | { ok: true; authToken: string; expectedAccountSid: string | null }
  | { ok: false; missing: string[] } {
  const authToken = pickTrimmed(TWILIO_ENV_KEYS.authToken);
  if (!authToken) return { ok: false, missing: [TWILIO_ENV_KEYS.authToken] };
  const expectedAccountSid = pickTrimmed(TWILIO_ENV_KEYS.accountSid);
  return { ok: true, authToken, expectedAccountSid };
}

/**
 * Non-throwing read for outbound — account + token + sender identity.
 */
export function readTwilioEnv(): TwilioEnvReadResult {
  const missing: string[] = [];
  const accountSid = pickTrimmed(TWILIO_ENV_KEYS.accountSid);
  const authToken = pickTrimmed(TWILIO_ENV_KEYS.authToken);
  if (!accountSid) missing.push(TWILIO_ENV_KEYS.accountSid);
  if (!authToken) missing.push(TWILIO_ENV_KEYS.authToken);

  const phoneNumber =
    pickTrimmed(TWILIO_ENV_KEYS.phoneNumber) || pickTrimmed(TWILIO_ENV_KEYS.legacyFrom);
  const messagingServiceSid = pickTrimmed(TWILIO_ENV_KEYS.messagingServiceSid);

  if (!phoneNumber && !messagingServiceSid) {
    missing.push(
      `${TWILIO_ENV_KEYS.phoneNumber} (or ${TWILIO_ENV_KEYS.legacyFrom} or ${TWILIO_ENV_KEYS.messagingServiceSid})`,
    );
  }

  if (missing.length) return { ok: false, missing };

  if (messagingServiceSid && !/^MG[a-f0-9]{32}$/i.test(messagingServiceSid)) {
    return {
      ok: false,
      missing: [`${TWILIO_ENV_KEYS.messagingServiceSid} (invalid — expected MG + 32 hex chars)`],
    };
  }

  if (!messagingServiceSid && phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return {
        ok: false,
        missing: [`${TWILIO_ENV_KEYS.phoneNumber} (invalid — use E.164 such as +15551234567)`],
      };
    }
  }

  return {
    ok: true,
    credentials: {
      accountSid: accountSid!,
      authToken: authToken!,
      phoneNumber,
      messagingServiceSid,
    },
  };
}

/**
 * Outbound send: requires full credential set including a sender identity.
 */
export function requireTwilioEnvForOutbound(): TwilioCredentials {
  const r = readTwilioEnv();
  if (!r.ok) {
    const msg = `Twilio is not configured for outbound SMS. Missing: ${r.missing.join(", ")}`;
    throw new Error(msg);
  }
  const { phoneNumber, messagingServiceSid } = r.credentials;
  if (!phoneNumber && !messagingServiceSid) {
    throw new Error(
      `Twilio outbound requires ${TWILIO_ENV_KEYS.phoneNumber} or ${TWILIO_ENV_KEYS.messagingServiceSid}`,
    );
  }
  return r.credentials;
}

/**
 * Inbound / status webhook signature verification only needs the auth token.
 */
export function requireTwilioAuthToken(): string {
  const t = pickTrimmed(TWILIO_ENV_KEYS.authToken);
  if (!t) {
    throw new Error(`Missing ${TWILIO_ENV_KEYS.authToken} (required for Twilio webhook verification)`);
  }
  return t;
}
