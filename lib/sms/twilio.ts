
export type SendSmsResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function normalizePhone(input: string): string {
  const trimmed = String(input || "").trim();

  // keep leading + if present, remove other non-digits
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }

  return trimmed.replace(/\D/g, "");
}

export async function sendTwilioSms(to: string, body: string): Promise<SendSmsResult> {
  try {
    const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const from = requireEnv("TWILIO_PHONE_NUMBER");

    const normalizedTo = normalizePhone(to);
    if (!normalizedTo) {
      return { ok: false, error: "Missing destination phone number." };
    }

    const normalizedBody = String(body || "").trim();
    if (!normalizedBody) {
      return { ok: false, error: "Missing SMS body." };
    }

    const form = new URLSearchParams();
    form.set("To", normalizedTo);
    form.set("From", from);
    form.set("Body", normalizedBody);

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        error: json?.message || `Twilio error (${res.status})`,
      };
    }

    return { ok: true, sid: String(json?.sid || "") };
  } catch (err: any) {
    return { ok: false, error: err?.message || "SMS send failed." };
  }
}