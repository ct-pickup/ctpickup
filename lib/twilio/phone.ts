import { TWILIO_MIN_PHONE_DIGITS } from "@/lib/twilio/constants";

/** Normalize user-entered phone toward E.164-style (digits, optional leading +). */
export function normalizePhoneNumber(input: string): string {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
}

/**
 * Loose check before hitting Twilio (E.164 digit count bounds, ITU max 15 digits).
 * National formats without "+" may still work for some Twilio accounts; we only enforce digit span.
 */
export function isPlausibleSmsDestination(normalizedTo: string): boolean {
  if (!normalizedTo) return false;
  const digits = normalizedTo.replace(/\D/g, "");
  return digits.length >= TWILIO_MIN_PHONE_DIGITS && digits.length <= 15;
}
