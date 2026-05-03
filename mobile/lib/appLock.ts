import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const K_SALT = "ctpickup_app_lock_salt_v1";
const K_HASH = "ctpickup_app_lock_hash_v1";
const K_BIO = "ctpickup_app_lock_biometrics_v1";

/** Minimum length after trim. */
export const PASSCODE_MIN_LEN = 8;
/** Maximum length stored / entered. */
export const PASSCODE_MAX_LEN = 128;

/** User-facing summary (rules enforced by `isValidPinFormat`). */
export const PASSCODE_REQUIREMENTS =
  `At least ${PASSCODE_MIN_LEN} characters, at least one number (0–9), up to ${PASSCODE_MAX_LEN} characters.`;

/** @deprecated Use PASSCODE_MAX_LEN — kept for any stale imports. */
export const PIN_LEN = PASSCODE_MAX_LEN;

export function normalizePasscode(pin: string): string {
  return pin.trim();
}

export function isValidPinFormat(pin: string): boolean {
  const t = normalizePasscode(pin);
  if (t.length < PASSCODE_MIN_LEN || t.length > PASSCODE_MAX_LEN) return false;
  if (!/\d/.test(t)) return false;
  return true;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${saltHex}:${pin}`);
}

export async function pinConfigured(): Promise<boolean> {
  const h = await SecureStore.getItemAsync(K_HASH);
  return Boolean(h && h.length > 0);
}

export async function saveNewPin(pin: string): Promise<void> {
  const p = normalizePasscode(pin);
  if (!isValidPinFormat(p)) throw new Error("invalid_pin");
  const bytes = await Crypto.getRandomBytesAsync(16);
  const salt = bytesToHex(bytes);
  const hash = await hashPin(p, salt);
  await SecureStore.setItemAsync(K_SALT, salt);
  await SecureStore.setItemAsync(K_HASH, hash);
}

export async function verifyStoredPin(pin: string): Promise<boolean> {
  const p = normalizePasscode(pin);
  const salt = await SecureStore.getItemAsync(K_SALT);
  const stored = await SecureStore.getItemAsync(K_HASH);
  if (!salt || !stored) return false;
  const h = await hashPin(p, salt);
  return h === stored;
}

export async function clearStoredPin(): Promise<void> {
  await SecureStore.deleteItemAsync(K_SALT);
  await SecureStore.deleteItemAsync(K_HASH);
  await SecureStore.deleteItemAsync(K_BIO);
}

export async function getBiometricsPref(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_BIO)) === "1";
}

export async function setBiometricsPref(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(K_BIO, "1");
  else await SecureStore.deleteItemAsync(K_BIO);
}
