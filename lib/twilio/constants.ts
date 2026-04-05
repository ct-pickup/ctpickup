/** Max POST body for inbound/status webhooks (DoS guard). Twilio payloads are small. */
export const TWILIO_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** Reasonable cap for outbound copy; Twilio allows longer concatenated SMS. */
export const TWILIO_OUTBOUND_BODY_MAX_CHARS = 1600;

/** Inbound Body can grow for MMS/long messages; cap parsing / command extraction. */
export const TWILIO_INBOUND_BODY_MAX_CHARS = 10_000;

/** Correlation ids are logged — bound length to avoid log abuse. */
export const TWILIO_CORRELATION_ID_MAX_LEN = 128;

/** E.164 needs at least country code + subscriber number (very loose floor). */
export const TWILIO_MIN_PHONE_DIGITS = 10;
