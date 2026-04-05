import twilio from "twilio";
import { twilioClientFor } from "@/lib/twilio/client";
import {
  TWILIO_CORRELATION_ID_MAX_LEN,
  TWILIO_OUTBOUND_BODY_MAX_CHARS,
} from "@/lib/twilio/constants";
import { readTwilioEnv } from "@/lib/twilio/env";
import { twilioLog, withPhoneLast4 } from "@/lib/twilio/logger";
import { isPlausibleSmsDestination, normalizePhoneNumber } from "@/lib/twilio/phone";
import type { SendSmsOptions, SendSmsResult } from "@/lib/twilio/types";

function clipCorrelationId(id: string | undefined): string | undefined {
  if (id === undefined || id === null) return undefined;
  const t = String(id).trim();
  if (!t) return undefined;
  return t.length > TWILIO_CORRELATION_ID_MAX_LEN ? t.slice(0, TWILIO_CORRELATION_ID_MAX_LEN) : t;
}

function resolveStatusCallback(explicit?: string): string | undefined {
  const raw = explicit?.trim() || process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const https = u.protocol === "https:";
    const httpDev = u.protocol === "http:" && process.env.NODE_ENV !== "production";
    if (!https && !httpDev) {
      twilioLog("warn", "outbound_status_callback_invalid_protocol", {});
      return undefined;
    }
    return raw;
  } catch {
    twilioLog("warn", "outbound_status_callback_invalid_url", {});
    return undefined;
  }
}

/**
 * Production outbound SMS — server-only. Uses Messaging Service SID when set, else From number.
 */
export async function sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
  const correlationId = clipCorrelationId(options.correlationId);

  const env = readTwilioEnv();
  if (!env.ok) {
    twilioLog("warn", "outbound_missing_env", { missing: env.missing });
    return {
      ok: false,
      error: `Twilio is not configured. Missing: ${env.missing.join(", ")}`,
    };
  }

  const c = env.credentials;
  const to = normalizePhoneNumber(options.to);
  if (!to || !isPlausibleSmsDestination(to)) {
    twilioLog("warn", "outbound_invalid_to", {
      kind: options.kind,
      correlationId,
    });
    return { ok: false, error: "Invalid or empty destination phone number." };
  }

  const body = String(options.body || "").trim();
  if (!body) {
    twilioLog("warn", "outbound_empty_body", withPhoneLast4({ kind: options.kind }, "to", to));
    return { ok: false, error: "SMS body cannot be empty." };
  }

  if (body.length > TWILIO_OUTBOUND_BODY_MAX_CHARS) {
    twilioLog("warn", "outbound_body_too_long", {
      kind: options.kind,
      correlationId,
      length: body.length,
      max: TWILIO_OUTBOUND_BODY_MAX_CHARS,
    });
    return {
      ok: false,
      error: `SMS body exceeds ${TWILIO_OUTBOUND_BODY_MAX_CHARS} characters.`,
    };
  }

  const statusCallback = resolveStatusCallback(options.statusCallbackUrl);

  twilioLog(
    "info",
    "outbound_attempt",
    withPhoneLast4(
      {
        kind: options.kind ?? "generic",
        correlationId,
        bodyLength: body.length,
        sender: c.messagingServiceSid ? "messaging_service" : "phone_number",
        statusCallback: Boolean(statusCallback),
      },
      "to",
      to,
    ),
  );

  const client = twilioClientFor(c);

  try {
    const msg = await client.messages.create({
      to,
      body,
      ...(statusCallback ? { statusCallback } : {}),
      ...(c.messagingServiceSid
        ? { messagingServiceSid: c.messagingServiceSid }
        : { from: c.phoneNumber as string }),
    });

    twilioLog(
      "info",
      "outbound_success",
      withPhoneLast4(
        {
          sid: msg.sid,
          status: msg.status,
          kind: options.kind ?? "generic",
          correlationId,
        },
        "to",
        to,
      ),
    );

    return { ok: true, sid: msg.sid, status: msg.status ?? null };
  } catch (err: unknown) {
    if (err instanceof twilio.RestException) {
      twilioLog(
        "error",
        "outbound_failure",
        withPhoneLast4(
          {
            kind: options.kind ?? "generic",
            correlationId,
            code: err.code,
            status: err.status,
            error: err.message,
          },
          "to",
          to,
        ),
      );
      return {
        ok: false,
        error: err.message || "Twilio SMS send failed.",
        code: err.code,
        status: err.status,
      };
    }

    const e = err as { message?: string; code?: string | number; status?: number };
    twilioLog(
      "error",
      "outbound_failure",
      withPhoneLast4(
        {
          kind: options.kind ?? "generic",
          correlationId,
          code: e.code,
          status: e.status,
          error: e.message || "Twilio request failed",
        },
        "to",
        to,
      ),
    );
    return {
      ok: false,
      error: e.message || "Twilio SMS send failed.",
      code: e.code,
      status: e.status,
    };
  }
}
