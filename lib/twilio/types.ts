/**
 * CT Pickup SMS domain — outbound campaign kinds and structured send results.
 * Database joins (invite id, run id, player id) are added at call sites later via metadata/logging.
 */

export type CtPickupSmsKind =
  | "run_invite"
  | "confirmation"
  | "reminder"
  | "spot_opened"
  | "tournament_alert"
  | "generic";

export type SendSmsOptions = {
  to: string;
  body: string;
  /** For analytics / future DB correlation — never logged in full if it contains PII. */
  kind?: CtPickupSmsKind;
  /** Optional id you already have (run id, invite id, etc.) — logged as opaque prefix only in debug paths. */
  correlationId?: string;
  /**
   * Twilio status callback URL for this message. When unset, `TWILIO_STATUS_CALLBACK_URL` is used if defined.
   * Use https in production.
   */
  statusCallbackUrl?: string;
};

export type SendSmsSuccess = {
  ok: true;
  sid: string;
  status: string | null;
};

export type SendSmsFailure = {
  ok: false;
  error: string;
  /** Twilio REST error code when available */
  code?: string | number;
  status?: number;
};

export type SendSmsResult = SendSmsSuccess | SendSmsFailure;

/** Normalized inbound command — maps to RSVP, standby, opt-out, confirmation flows later. */
export type SmsReplyCommand =
  | "RSVP_YES"
  | "RSVP_NO"
  | "OPT_OUT"
  | "CONFIRM"
  | "HELP"
  | "UNKNOWN";

export type ParsedInboundSms = {
  accountSid: string;
  fromE164: string;
  toE164: string;
  messageSid: string;
  rawBody: string;
  normalizedBody: string;
  command: SmsReplyCommand;
};

/** Twilio status callback — easy to persist later (message_logs table, etc.). */
export type TwilioMessageStatusPayload = {
  messageSid: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  to: string;
  from: string | null;
  accountSid: string | null;
};
