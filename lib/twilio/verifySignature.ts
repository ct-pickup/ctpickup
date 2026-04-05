import twilio from "twilio";
import { twilioLog } from "@/lib/twilio/logger";

const SKIP_FLAG = "TWILIO_SKIP_SIGNATURE_VALIDATION";

/**
 * Validates X-Twilio-Signature per https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * If TWILIO_SKIP_SIGNATURE_VALIDATION=1 (e.g. local tunnel URL mismatch), validation is skipped.
 * Never enable skip in production.
 */
export function verifyTwilioSignature(opts: {
  authToken: string;
  signatureHeader: string | null;
  url: string;
  params: Record<string, string>;
}): { ok: true } | { ok: false; reason: string } {
  const skip = process.env[SKIP_FLAG] === "1" || process.env[SKIP_FLAG] === "true";
  if (skip) {
    if (process.env.NODE_ENV === "production") {
      twilioLog("error", "signature_skip_rejected_in_production", {
        flag: SKIP_FLAG,
      });
      return { ok: false, reason: "Signature skip is not allowed in production." };
    }
    twilioLog("warn", "signature_validation_skipped", {
      flag: SKIP_FLAG,
      reason: "development_only",
    });
    return { ok: true };
  }

  if (!opts.signatureHeader) {
    return { ok: false, reason: "Missing X-Twilio-Signature header." };
  }

  const valid = twilio.validateRequest(
    opts.authToken,
    opts.signatureHeader,
    opts.url,
    opts.params,
  );

  if (!valid) {
    try {
      const u = new URL(opts.url);
      twilioLog("warn", "signature_invalid", {
        host: u.host,
        pathname: u.pathname,
        hint: "Confirm TWILIO_WEBHOOK_BASE_URL or NEXT_PUBLIC_SITE_URL matches the Twilio Console webhook URL exactly.",
      });
    } catch {
      twilioLog("warn", "signature_invalid", { urlMalformed: true });
    }
    return { ok: false, reason: "Invalid Twilio signature." };
  }

  return { ok: true };
}
