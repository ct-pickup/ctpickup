import type { TwilioMessageStatusPayload } from "@/lib/twilio/types";

export function parseTwilioStatusCallback(
  params: Record<string, string>,
): TwilioMessageStatusPayload | null {
  const messageSid = (params.MessageSid || params.SmsSid || "").trim();
  if (!messageSid) return null;

  const status = (params.MessageStatus || params.SmsStatus || "").trim() || "unknown";
  const errorCode = (params.ErrorCode || "").trim() || null;
  const errorMessage = (params.ErrorMessage || "").trim() || null;
  const to = (params.To || "").trim();
  const from = (params.From || "").trim() || null;
  const accountSid = (params.AccountSid || "").trim() || null;

  return {
    messageSid,
    status,
    errorCode,
    errorMessage,
    to,
    from,
    accountSid,
  };
}
