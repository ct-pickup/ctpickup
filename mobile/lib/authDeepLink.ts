/** Tokens from Supabase password-recovery redirects (query or hash). */
export type RecoveryLinkParams = {
  type?: string;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export function parseRecoveryLinkParams(url: string): RecoveryLinkParams {
  const out: RecoveryLinkParams = {};
  const [beforeHash, hashPartRaw] = url.split("#");
  const queryPart = beforeHash.split("?")[1] ?? "";
  const hashPart = hashPartRaw ?? "";

  function fillFrom(part: string) {
    if (!part) return;
    const s = part.startsWith("?") ? part.slice(1) : part;
    const params = new URLSearchParams(s);
    for (const [k, v] of params.entries()) {
      (out as Record<string, string>)[k] = v;
    }
  }

  fillFrom(queryPart);
  fillFrom(hashPart);
  return out;
}

export function isResetPasswordDeepLink(url: string): boolean {
  return url.includes("reset-password");
}
