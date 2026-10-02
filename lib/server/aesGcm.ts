import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 32-byte key for one purpose, so a single secret never encrypts two kinds of data with the same key. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(purpose).digest();
}

/** AES-256-GCM, base64url of iv | tag | ciphertext. aad must be supplied again to open. */
export function sealText(key: Buffer, aad: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The plaintext, or null when the token is malformed, tampered with, or sealed with another key or aad. */
export function openText(key: Buffer, aad: string, token: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
