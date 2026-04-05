/**
 * Structured Twilio logs — no secrets, minimal PII (last 4 of E.164 only).
 */

function last4Phone(e164: string): string {
  const d = String(e164 || "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : d.slice(-4);
}

export function twilioLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  const line = {
    event: `twilio.${event}`,
    ...fields,
  };
  const msg = `[ctpickup.twilio] ${event}`;
  if (level === "info") console.info(msg, line);
  else if (level === "warn") console.warn(msg, line);
  else console.error(msg, line);
}

export function withPhoneLast4(
  fields: Record<string, unknown>,
  key: "to" | "from",
  e164: string,
): Record<string, unknown> {
  return { ...fields, [`${key}Last4`]: last4Phone(e164) };
}

export { last4Phone };
