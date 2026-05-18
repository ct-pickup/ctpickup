const REFERRAL_CODE_RE = /^[A-Z0-9]{6}$/;

export function normalizeReferralCodeInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!REFERRAL_CODE_RE.test(code)) return null;
  return code;
}

export function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_RE.test(code);
}
