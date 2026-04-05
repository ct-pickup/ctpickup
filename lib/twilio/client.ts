import twilio from "twilio";
import type { Twilio } from "twilio";
import type { TwilioCredentials } from "@/lib/twilio/env";
import { requireTwilioEnvForOutbound } from "@/lib/twilio/env";

type CachedClient = { authToken: string; client: Twilio };

const byAccountSid = new Map<string, CachedClient>();

/**
 * Reuses a Rest client per Account SID for the Node process, but refreshes the client when
 * `TWILIO_AUTH_TOKEN` changes (token rotation) so we never keep stale credentials.
 */
export function twilioClientFor(credentials: TwilioCredentials): Twilio {
  const prev = byAccountSid.get(credentials.accountSid);
  if (prev && prev.authToken === credentials.authToken) {
    return prev.client;
  }
  const client = twilio(credentials.accountSid, credentials.authToken);
  byAccountSid.set(credentials.accountSid, { authToken: credentials.authToken, client });
  return client;
}

/** Rest client for Messages API — do not import from client components. */
export function getTwilioRestClient(): Twilio {
  return twilioClientFor(requireTwilioEnvForOutbound());
}
