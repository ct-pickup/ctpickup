import { deriveKey, openText, sealText } from "@/lib/server/aesGcm";

/**
 * Opaque, run-scoped handle for a Fill your game candidate. AES-256-GCM over
 * "run_id|user_id" so clients never see the invitee's user id; the key is
 * derived from SUPABASE_SERVICE_ROLE_KEY with a purpose label.
 */
const PURPOSE = "ctpickup:match-invite-token:v1";

function tokenKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return deriveKey(secret, PURPOSE);
}

export function createInviteToken(runId: string, userId: string): string {
  return sealText(tokenKey(), PURPOSE, `${runId}|${userId}`);
}

/** The invitee's user id, or null when the token is malformed, tampered with or for another run. */
export function readInviteToken(token: string, runId: string): string | null {
  let key: Buffer;
  try {
    key = tokenKey();
  } catch {
    return null;
  }
  const text = openText(key, PURPOSE, token);
  if (text == null) return null;
  const [tokenRun, userId] = text.split("|");
  if (tokenRun !== runId || !userId) return null;
  return userId;
}
