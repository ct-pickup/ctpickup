/**
 * Legacy import path — re-exports the canonical Twilio helpers under `lib/twilio/`.
 */
export { sendSms, sendSms as sendTwilioSms } from "@/lib/twilio/sendSms";
export type { SendSmsOptions, SendSmsResult } from "@/lib/twilio/types";
