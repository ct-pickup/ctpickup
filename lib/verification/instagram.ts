import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { deriveKey, openText, sealText } from "@/lib/server/aesGcm";
import {
  VERIFICATION_CODE_ALPHABET,
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_HINT_LENGTH,
  VERIFICATION_UNAVAILABLE_MESSAGE,
} from "@/shared/instagramVerification";

/**
 * Server side of Instagram verification. The code is never stored in the clear:
 *   * code_hash: HMAC-SHA256(code) under a key derived from INSTAGRAM_VERIFY_SECRET. Unique across all
 *     requests, so a code is never issued twice. Approval recomputes it from the code the admin typed.
 *   * code_ciphertext: AES-256-GCM of the code under a second derived key, with the owner's user id as
 *     AAD, so only GET /api/account/instagram-verification for that user can show it again.
 *   * code_hint: the last 2 characters, so the admin can match a DM to a queue row.
 */
export const INSTAGRAM_VERIFY_SECRET_ENV = "INSTAGRAM_VERIFY_SECRET";
export const IG_VERIFY_TABLE = "instagram_verification_requests";
export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_RATE_LIMIT = { limit: 5, windowSeconds: 24 * 60 * 60 };

const HASH_PURPOSE = "ctpickup:instagram-verify:code-hash:v1";
const SEAL_PURPOSE = "ctpickup:instagram-verify:code-seal:v1";

function secret(): string {
  const value = process.env[INSTAGRAM_VERIFY_SECRET_ENV]?.trim();
  if (!value) throw new Error(`Missing ${INSTAGRAM_VERIFY_SECRET_ENV}`);
  return value;
}

export function instagramVerifySecretConfigured(): boolean {
  return !!process.env[INSTAGRAM_VERIFY_SECRET_ENV]?.trim();
}

export function generateVerificationCode(pick: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    code += VERIFICATION_CODE_ALPHABET[pick(VERIFICATION_CODE_ALPHABET.length)];
  }
  return code;
}

export function hashVerificationCode(code: string): string {
  return createHmac("sha256", deriveKey(secret(), HASH_PURPOSE)).update(code).digest("hex");
}

export function verificationCodeMatches(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashVerificationCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verificationCodeHint(code: string): string {
  return code.slice(-VERIFICATION_HINT_LENGTH);
}

export function sealVerificationCode(code: string, userId: string): string {
  return sealText(deriveKey(secret(), SEAL_PURPOSE), `${SEAL_PURPOSE}|${userId}`, code);
}

export function openVerificationCode(token: string, userId: string): string | null {
  return openText(deriveKey(secret(), SEAL_PURPOSE), `${SEAL_PURPOSE}|${userId}`, token);
}

export function verificationExpiresAt(now: Date): string {
  return new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString();
}

export function isVerificationExpired(row: { expires_at: string }, now: Date): boolean {
  return new Date(row.expires_at).getTime() <= now.getTime();
}

type DbError = { code?: string; message?: string } | null | undefined;

/** The migration has not run yet: table, column or enum value missing. */
export function isMissingSchema(err: DbError): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    err.code === "PGRST204" ||
    /does not exist|schema cache|could not find the table|invalid input value for enum/i.test(msg)
  );
}

export function isUniqueViolation(err: DbError, constraint?: string): boolean {
  if (!err || err.code !== "23505") return false;
  return !constraint || String(err.message ?? "").includes(constraint);
}

export function unavailableResponse() {
  return NextResponse.json({ error: VERIFICATION_UNAVAILABLE_MESSAGE, unavailable: true }, { status: 503 });
}

export function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

/** Instagram is shown publicly only when the owner opted in and the profile is Instagram-verified. */
export function publicInstagramHandle(p: {
  show_instagram?: boolean | null;
  instagram_handle?: string | null;
  verification_level?: string | null;
}): string | null {
  if (p.show_instagram !== true || p.verification_level !== "instagram") return null;
  return p.instagram_handle?.trim() || null;
}
