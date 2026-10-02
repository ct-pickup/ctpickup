/**
 * Instagram verification rules shared by the site API and the mobile app.
 * Pure: no Node or React Native imports.
 */

export const INSTAGRAM_HANDLE_MAX = 30;
const HANDLE_RE = /^[a-z0-9._]+$/;

/** Lowercase handle without "@", or null when it is empty, too long or has characters Instagram does not allow. */
export function normalizeInstagramHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!handle || handle.length > INSTAGRAM_HANDLE_MAX || !HANDLE_RE.test(handle)) return null;
  return handle;
}

/** No 0/O, 1/I/L: the admin reads the code out of a DM and types it back. */
export const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_PREFIX = "CTP-";
export const VERIFICATION_HINT_LENGTH = 2;

export function formatVerificationCode(code: string): string {
  return `${VERIFICATION_CODE_PREFIX}${code}`;
}

/** Accepts "CTP-ABC234", "ctp abc234" or "ABC234"; returns the bare 6-character code or null. */
export function normalizeVerificationCodeInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length === VERIFICATION_CODE_LENGTH + 3 && code.startsWith("CTP")) code = code.slice(3);
  if (code.length !== VERIFICATION_CODE_LENGTH) return null;
  for (const ch of code) if (!VERIFICATION_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "CTP-••••XY": what the admin queue shows instead of the code. */
export function maskedVerificationHint(hint: string): string {
  return `${VERIFICATION_CODE_PREFIX}${"•".repeat(VERIFICATION_CODE_LENGTH - hint.length)}${hint}`;
}

/** The handle comes from the brand module (lib/brand.ts, mobile/lib/brand.ts). */
export function instagramProfileUrls(handle: string): { app: string; web: string } {
  const h = encodeURIComponent(handle);
  return { app: `instagram://user?username=${h}`, web: `https://instagram.com/${h}` };
}

export function verificationDmInstruction(dmHandle: string, playerHandle: string, code: string): string {
  return `DM this code to @${dmHandle} from @${playerHandle}: ${code}`;
}

export const VERIFICATION_UNAVAILABLE_MESSAGE = "Verification isn't available yet.";

export type InstagramVerificationStatus = "none" | "pending" | "approved" | "rejected" | "expired";

/** GET /api/account/instagram-verification. */
export type InstagramVerificationState = {
  status: InstagramVerificationStatus;
  /** Handle of the latest request. */
  handle: string | null;
  /** "CTP-XXXXXX", only while the request is pending. */
  code: string | null;
  expires_at: string | null;
  reject_reason: string | null;
  /** The profile is verified through Instagram. */
  verified: boolean;
  /** The profile is already verified another way, so Instagram verification is not offered. */
  verified_other: boolean;
  show_instagram: boolean;
};

/** One row of GET /api/admin/instagram-verification. */
export type InstagramVerificationQueueItem = {
  id: string;
  user_id: string;
  handle: string;
  code_hint: string;
  status: InstagramVerificationStatus;
  created_at: string;
  expires_at: string;
  reviewed_at: string | null;
  reject_reason: string | null;
  name: string;
  username: string | null;
  avatar_url: string | null;
};
