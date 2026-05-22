import type { SupabaseClient } from "@supabase/supabase-js";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const K_ENABLED = "ctpickup_signin_biometrics_v1";
const K_EMAIL = "ctpickup_signin_email_v1";
const K_PASSWORD = "ctpickup_signin_password_v1";

export async function biometricSignInLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "Touch ID";
  return "Biometrics";
}

export async function isBiometricSignInAvailable(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return has && enrolled;
}

export async function isBiometricSignInEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_ENABLED)) === "1";
}

export async function getBiometricSignInEmail(): Promise<string | null> {
  const email = await SecureStore.getItemAsync(K_EMAIL);
  return email?.trim().toLowerCase() || null;
}

/**
 * If this device has stored sign-in credentials for `email`, try `signInWithPassword`
 * without a biometric prompt. Used after OTP to detect accounts that already have a password.
 */
export async function trySilentSignInWithStoredPassword(
  supabase: SupabaseClient,
  email: string,
): Promise<boolean> {
  const enabled = await isBiometricSignInEnabled();
  if (!enabled) return false;
  const storedEmail = await getBiometricSignInEmail();
  const emailClean = email.trim().toLowerCase();
  if (!storedEmail || storedEmail !== emailClean) return false;
  const password = await SecureStore.getItemAsync(K_PASSWORD);
  if (!password) return false;
  const { error } = await supabase.auth.signInWithPassword({ email: emailClean, password });
  return !error;
}

export async function enableBiometricSignIn(email: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(K_ENABLED, "1");
  await SecureStore.setItemAsync(K_EMAIL, email.trim().toLowerCase());
  await SecureStore.setItemAsync(K_PASSWORD, password);
}

export async function disableBiometricSignIn(): Promise<void> {
  await SecureStore.deleteItemAsync(K_ENABLED);
  await SecureStore.deleteItemAsync(K_EMAIL);
  await SecureStore.deleteItemAsync(K_PASSWORD);
}

export async function clearBiometricSignIn(): Promise<void> {
  await disableBiometricSignIn();
}

export type BiometricSignInCredentials = { email: string; password: string };

export async function unlockBiometricSignInCredentials(): Promise<
  | { ok: true; credentials: BiometricSignInCredentials }
  | { ok: false; error: string }
> {
  const enabled = await isBiometricSignInEnabled();
  if (!enabled) return { ok: false, error: "disabled" };

  const available = await isBiometricSignInAvailable();
  if (!available) return { ok: false, error: "not_available" };

  const label = await biometricSignInLabel();
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: `Sign in with ${label}`,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use password",
  });
  if (!r.success) {
    const e =
      typeof (r as { error?: unknown }).error === "string" ? ((r as { error: string }).error as string) : "failed";
    return { ok: false, error: e };
  }

  const email = await SecureStore.getItemAsync(K_EMAIL);
  const password = await SecureStore.getItemAsync(K_PASSWORD);
  if (!email || !password) {
    await disableBiometricSignIn();
    return { ok: false, error: "missing_credentials" };
  }

  return { ok: true, credentials: { email: email.trim().toLowerCase(), password } };
}
