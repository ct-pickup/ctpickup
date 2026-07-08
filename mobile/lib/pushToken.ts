import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

export type MobileInstallationContext = "storeClient" | "standalone" | "bare";

export function getInstallationContext(): MobileInstallationContext {
  switch (Constants.executionEnvironment) {
    case ExecutionEnvironment.StoreClient:
      return "storeClient";
    case ExecutionEnvironment.Standalone:
      return "standalone";
    case ExecutionEnvironment.Bare:
      return "bare";
    default:
      return Constants.appOwnership === "expo" ? "storeClient" : "standalone";
  }
}

/** Expo Go / simulator tokens cannot receive pushes for EAS production builds. */
export function shouldRegisterPushToken(): boolean {
  if (!Device.isDevice) return false;
  return getInstallationContext() !== "storeClient";
}

export function getEasProjectId(): string | undefined {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  return projectId ? String(projectId) : undefined;
}

export async function resolveExpoPushTokenForApp(): Promise<string | null> {
  if (!shouldRegisterPushToken()) {
    console.warn(
      "[push] Skipping token registration — use a development or production build (Expo Go cannot receive production pushes).",
    );
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    console.warn("[push] Missing EAS projectId — set extra.eas.projectId in app.json or EXPO_PUBLIC_EAS_PROJECT_ID");
  }

  try {
    const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return tokenRes.data || null;
  } catch (e) {
    console.warn("[push] getExpoPushTokenAsync failed (network or Expo service error):", e);
    return null;
  }
}
