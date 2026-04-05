import { TWILIO_INBOUND_BODY_MAX_CHARS } from "@/lib/twilio/constants";
import type { ParsedInboundSms, SmsReplyCommand } from "@/lib/twilio/types";

/** Uppercase, trim, collapse internal whitespace — good for keyword matching. */
export function normalizeSmsReplyText(body: string): string {
  return String(body || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function firstToken(normalized: string): string {
  const t = normalized.split(/[\s,;]+/)[0] ?? "";
  return t.replace(/[^A-Z0-9]/g, "");
}

const YES = new Set(["YES", "Y", "YEP", "YEAH", "YUP", "OK", "OKAY", "SURE"]);
const NO = new Set(["NO", "N", "NOPE", "CANT", "CANNOT"]);
const CONFIRM = new Set(["CONFIRM", "CONFIRMED", "CONFIRMATION"]);

function isLikelyOptOut(normalizedBody: string): boolean {
  const u = normalizedBody.trim();
  if (!u) return false;
  const head = u.split(/\s+/)[0] ?? "";

  // Carrier / CTIA-style keywords — first token to allow "STOP ALL"
  if (head === "STOP" || head === "STOPALL" || head === "UNSUBSCRIBE") return true;

  // Exact-only short words to avoid "cancel my rsvp" being treated as global SMS opt-out
  if (u === "END" || u === "QUIT" || u === "CANCEL") return true;

  return false;
}

/**
 * Map player reply → intent for RSVP / standby / opt-out / confirmation loops.
 * Future: include last outbound MessageSid or short code in body to tie to a specific run.
 */
export function parseSmsReplyCommand(normalizedBody: string): SmsReplyCommand {
  const u = normalizedBody.trim();
  const head = u.split(/\s+/)[0] ?? "";

  if (head === "HELP" || head === "INFO") return "HELP";

  const compact = normalizedBody.replace(/[^A-Z0-9]/g, "");
  const token = firstToken(normalizedBody);

  if (isLikelyOptOut(normalizedBody)) return "OPT_OUT";

  if (YES.has(token) || YES.has(compact)) return "RSVP_YES";
  if (NO.has(token) || NO.has(compact)) return "RSVP_NO";
  if (CONFIRM.has(token) || CONFIRM.has(compact)) return "CONFIRM";

  return "UNKNOWN";
}

export function parseInboundSmsPayload(params: Record<string, string>): ParsedInboundSms | null {
  const accountSid = params.AccountSid?.trim();
  const from = params.From?.trim();
  const to = params.To?.trim();
  const messageSid = (params.MessageSid || params.SmsMessageSid || "").trim();
  let body = params.Body ?? "";

  if (!accountSid || !from || !to || !messageSid) return null;

  if (body.length > TWILIO_INBOUND_BODY_MAX_CHARS) {
    body = body.slice(0, TWILIO_INBOUND_BODY_MAX_CHARS);
  }

  const normalizedBody = normalizeSmsReplyText(body);
  const command = parseSmsReplyCommand(normalizedBody);

  return {
    accountSid,
    fromE164: from,
    toE164: to,
    messageSid,
    rawBody: body,
    normalizedBody,
    command,
  };
}

export function twimlSmsResponse(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export function twimlEmptyResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/** User-facing auto-reply copy — keep short for SMS segments. */
export function autoReplyForCommand(command: SmsReplyCommand): string {
  switch (command) {
    case "RSVP_YES":
      return "CT Pickup: Thanks — we received YES. You'll get a confirmation in the app when your spot is locked in.";
    case "RSVP_NO":
      return "CT Pickup: Thanks — we received NO. Hope to see you at the next run.";
    case "CONFIRM":
      return "CT Pickup: Confirmed. See you on the court.";
    case "OPT_OUT":
      return "CT Pickup: You're opted out of SMS. Reply HELP for options or visit ctpickup.net.";
    case "HELP":
      return "CT Pickup: Reply YES / NO / CONFIRM for runs, STOP to opt out, or use the app at ctpickup.net.";
    default:
      return "CT Pickup: Reply YES, NO, CONFIRM, HELP, or STOP. For more, visit ctpickup.net.";
  }
}
