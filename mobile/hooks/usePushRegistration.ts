import { postMobilePushToken } from "@/lib/siteApi";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.warn("[push] setNotificationHandler failed:", e);
}

/**
 * Registers the device for Expo push and sends the token to the Next.js API (Apple APNs path via Expo).
 * No SMS/Twilio — server-side sends should use Expo Push API + stored tokens.
 */
export function usePushRegistration(accessToken: string | null) {
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      lastSent.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      if (!Device.isDevice) return;

      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
      }
      if (finalStatus !== "granted" || cancelled) return;

      let expoPushToken: string;
      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId ??
          process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
        const tokenRes = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId: String(projectId) } : undefined,
        );
        expoPushToken = tokenRes.data;
      } catch (e) {
        console.warn("[push] getExpoPushTokenAsync failed:", e);
        return;
      }

      if (cancelled || !expoPushToken) return;
      if (lastSent.current === expoPushToken) return;

      const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
      if (!platform) return;

      const res = await postMobilePushToken(accessToken, expoPushToken, platform);
      if (res.ok) lastSent.current = expoPushToken;
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);
}
