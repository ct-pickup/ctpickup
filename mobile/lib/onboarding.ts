import { appAsyncStorage } from "@/lib/appAsyncStorage";
import type { Href } from "expo-router";

export const ONBOARDING_COMPLETED_STORAGE_KEY = "ctpickup.onboarding.completed.v1";

export async function isOnboardingCompleted(): Promise<boolean> {
  try {
    const v = await appAsyncStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY);
    return v === "true";
  } catch {
    return true;
  }
}

export async function markOnboardingCompleted(): Promise<void> {
  try {
    await appAsyncStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "true");
  } catch {
    /* ignore */
  }
}

/** Route after sign-in when waiver/profile gates are handled elsewhere. */
export async function getPostAuthHref(): Promise<Href> {
  const done = await isOnboardingCompleted();
  return done ? "/(tabs)" : "/onboarding";
}
