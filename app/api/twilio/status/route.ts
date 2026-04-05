import { readTwilioWebhookEnv } from "@/lib/twilio/env";
import { twilioLog, withPhoneLast4 } from "@/lib/twilio/logger";
import {
  parseTwilioFormBody,
  TwilioWebhookBodyTooLargeError,
} from "@/lib/twilio/parseFormBody";
import { parseTwilioStatusCallback } from "@/lib/twilio/statusPayload";
import { verifyTwilioWebhookAccountSid } from "@/lib/twilio/webhookAccount";
import { buildPublicWebhookUrl } from "@/lib/twilio/webhookUrl";
import { verifyTwilioSignature } from "@/lib/twilio/verifySignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio status callback — delivery lifecycle (queued, sent, delivered, failed, undelivered, …).
 *
 * **Idempotency:** You may see the same `MessageSid` with updated `MessageStatus` many times.
 * Upserts should be keyed by `(message_sid, status)` or store only the latest status with a monotonic rule.
 *
 * Integration points (future):
 * - Upsert `sms_message_status` or audit log by MessageSid + status.
 * - Drive retries / alerts when status is `failed` or `undelivered`.
 */
export async function POST(req: Request) {
  const webhookEnv = readTwilioWebhookEnv();
  if (!webhookEnv.ok) {
    twilioLog("error", "status_misconfigured", { missing: webhookEnv.missing });
    return new Response("Service Unavailable", { status: 503 });
  }

  let params: Record<string, string>;
  try {
    params = await parseTwilioFormBody(req);
  } catch (err) {
    if (err instanceof TwilioWebhookBodyTooLargeError) {
      twilioLog("warn", "status_body_too_large", {});
      return new Response("Payload Too Large", { status: 413 });
    }
    twilioLog("warn", "status_body_parse_failed", {});
    return new Response("Bad Request", { status: 400 });
  }

  const signature = req.headers.get("x-twilio-signature");
  const url = buildPublicWebhookUrl(req);
  const sigResult = verifyTwilioSignature({
    authToken: webhookEnv.authToken,
    signatureHeader: signature,
    url,
    params,
  });

  if (!sigResult.ok) {
    twilioLog("warn", "status_signature_rejected", { reason: sigResult.reason });
    return new Response("Forbidden", { status: 403 });
  }

  const acct = verifyTwilioWebhookAccountSid(params, webhookEnv.expectedAccountSid);
  if (!acct.ok) {
    twilioLog("warn", "status_account_rejected", { reason: acct.reason });
    return new Response("Forbidden", { status: 403 });
  }

  const payload = parseTwilioStatusCallback(params);
  if (!payload) {
    twilioLog("warn", "status_invalid_payload", {
      keys: Object.keys(params).slice(0, 12),
    });
    return new Response("OK", { status: 200 });
  }

  const level =
    payload.status === "failed" || payload.status === "undelivered" ? "warn" : "info";

  const logFields: Record<string, unknown> = {
    messageSid: payload.messageSid,
    status: payload.status,
    errorCode: payload.errorCode,
    accountSidSuffix: payload.accountSid ? payload.accountSid.slice(-4) : null,
  };
  if (payload.to) Object.assign(logFields, withPhoneLast4({}, "to", payload.to));

  twilioLog(level, "delivery_status", logFields);

  // --- Persist delivery state (scaffolding) --------------------------------------
  // await saveMessageDeliveryStatus(payload);
  // -------------------------------------------------------------------------------

  return new Response("OK", { status: 200 });
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
