import { TWILIO_WEBHOOK_MAX_BODY_BYTES } from "@/lib/twilio/constants";

export class TwilioWebhookBodyTooLargeError extends Error {
  constructor() {
    super(`Webhook body exceeds ${TWILIO_WEBHOOK_MAX_BODY_BYTES} bytes`);
    this.name = "TwilioWebhookBodyTooLargeError";
  }
}

/**
 * Read Twilio webhook raw body with a hard size cap (Twilio SMS callbacks are tiny).
 */
export async function readTwilioWebhookRawBody(req: Request): Promise<string> {
  const max = TWILIO_WEBHOOK_MAX_BODY_BYTES;
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > max) {
      throw new TwilioWebhookBodyTooLargeError();
    }
  }

  const ab = await req.arrayBuffer();
  if (ab.byteLength > max) {
    throw new TwilioWebhookBodyTooLargeError();
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(ab);
}

/** Twilio SMS webhooks use application/x-www-form-urlencoded. */
export function parseUrlEncodedWebhookParams(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Full parse: bounded read + urlencoded params (Twilio’s format for SMS webhooks).
 */
export async function parseTwilioFormBody(req: Request): Promise<Record<string, string>> {
  const raw = await readTwilioWebhookRawBody(req);
  return parseUrlEncodedWebhookParams(raw);
}
