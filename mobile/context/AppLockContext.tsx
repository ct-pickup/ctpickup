import {
  clearStoredPin,
  getBiometricsPref,
  isValidPinFormat,
  pinConfigured,
  saveNewPin,
  setBiometricsPref,
  verifyStoredPin,
} from "@/lib/appLock";
import * as LocalAuthentication from "expo-local-authentication";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus, View } from "react-native";

type AppLockContextValue = {
  bootReady: boolean;
  hasPin: boolean;
  isLocked: boolean;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  unlockWithPin: (pin: string) => Promise<boolean>;
  lockNow: () => void;
  /** First-time enroll. Session stays unlocked. */
  savePin: (pin: string) => Promise<void>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  removePin: (currentPin: string) => Promise<boolean>;
  setBiometricsEnabled: (enabled: boolean) => Promise<void>;
  tryBiometricUnlock: () => Promise<{ ok: boolean; error?: string }>;
  refreshBiometricAvailability: () => Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [bootReady, setBootReady] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const refreshBiometricAvailability = useCallback(async () => {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setBiometricsAvailable(has && enrolled);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const configured = await pinConfigured();
        const bio = await getBiometricsPref();
        setHasPin(configured);
        setIsLocked(configured);
        setBiometricsEnabledState(bio);
        await refreshBiometricAvailability();
      } catch (e) {
        console.warn("[appLock] bootstrap failed:", e);
      } finally {
        setBootReady(true);
      }
    })();
  }, [refreshBiometricAvailability]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev?.match(/inactive|active/) && next === "background" && hasPin) {
        setIsLocked(true);
      }
    });
    return () => sub.remove();
  }, [hasPin]);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const ok = await verifyStoredPin(pin);
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const lockNow = useCallback(() => {
    if (hasPin) setIsLocked(true);
  }, [hasPin]);

  const savePin = useCallback(async (pin: string) => {
    if (!isValidPinFormat(pin)) throw new Error("invalid_pin");
    await saveNewPin(pin);
    setHasPin(true);
    setIsLocked(false);
  }, []);

  const changePin = useCallback(async (currentPin: string, newPin: string): Promise<boolean> => {
    if (!isValidPinFormat(newPin)) return false;
    const ok = await verifyStoredPin(currentPin);
    if (!ok) return false;
    await saveNewPin(newPin);
    return true;
  }, []);

  const removePin = useCallback(async (currentPin: string): Promise<boolean> => {
    const ok = await verifyStoredPin(currentPin);
    if (!ok) return false;
    await clearStoredPin();
    setHasPin(false);
    setIsLocked(false);
    setBiometricsEnabledState(false);
    return true;
  }, []);

  const setBiometricsEnabled = useCallback(async (enabled: boolean) => {
    await setBiometricsPref(enabled);
    setBiometricsEnabledState(enabled);
  }, []);

  const tryBiometricUnlock = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!biometricsEnabled || !hasPin) return { ok: false, error: "disabled" };
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!has || !enrolled) return { ok: false, error: "not_available" };

    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock CT Pickup",
      cancelLabel: "Cancel",
      // Let iOS fall back to device passcode if needed.
      disableDeviceFallback: false,
      fallbackLabel: "Use Passcode",
    });
    if (r.success) {
      setIsLocked(false);
      return { ok: true };
    }
    // Common error values: "user_cancel", "user_fallback", "system_cancel", "lockout", etc.
    const e = typeof (r as { error?: unknown }).error === "string" ? ((r as { error: string }).error as string) : "failed";
    return { ok: false, error: e };
  }, [biometricsEnabled, hasPin]);

  const value = useMemo(
    () => ({
      bootReady,
      hasPin,
      isLocked,
      biometricsEnabled,
      biometricsAvailable,
      unlockWithPin,
      lockNow,
      savePin,
      changePin,
      removePin,
      setBiometricsEnabled,
      tryBiometricUnlock,
      refreshBiometricAvailability,
    }),
    [
      bootReady,
      hasPin,
      isLocked,
      biometricsEnabled,
      biometricsAvailable,
      unlockWithPin,
      lockNow,
      savePin,
      changePin,
      removePin,
      setBiometricsEnabled,
      tryBiometricUnlock,
      refreshBiometricAvailability,
    ],
  );

  if (!bootReady) {
    return <View style={{ flex: 1, backgroundColor: "#0a0a0a" }} />;
  }

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within AppLockProvider");
  return ctx;
}
