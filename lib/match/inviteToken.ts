import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

/**
 * Opaque, run-scoped handle for a Fill your game candidate. AES-256-GCM over
 * "run_id|user_id" so clients never see the invitee's user id; the key is
 * derived from SUPABASE_SERVICE_ROLE_KEY with a purpose label.
 */
const PURPOSE = "ctpickup:match-invite-token:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function tokenKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

export function createInviteToken(runId: string, userId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  cipher.setAAD(Buffer.from(PURPOSE));
  const body = Buffer.concat([cipher.update(`${runId}|${userId}`, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The invitee's user id, or null when the token is malformed, tampered with or for another run. */
export function readInviteToken(token: string, runId: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(PURPOSE));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    const [tokenRun, userId] = text.split("|");
    if (tokenRun !== runId || !userId) return null;
    return userId;
  } catch {
    return null;
  }
}
