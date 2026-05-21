import type { SupabaseClient } from "@supabase/supabase-js";

/** Tokens from Supabase password-recovery redirects (query or hash). */
export type RecoveryLinkParams = {
  type?: string;
  access_token?: string;
  refresh_token?: string;
  token_hash?: string;
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

/** Establish a Supabase session from reset-password deep link tokens before navigating. */
export async function establishRecoverySession(
  supabase: SupabaseClient,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isResetPasswordDeepLink(url)) {
    return { ok: false, error: "not a reset-password link" };
  }

  const params = parseRecoveryLinkParams(url);

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      console.warn("[auth] recovery setSession failed", error.message ?? error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (params.token_hash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type: "recovery",
    });
    if (error) {
      console.warn("[auth] recovery verifyOtp failed", error.message ?? error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  return { ok: false, error: "missing recovery tokens" };
}
