import { postMobilePushToken } from "@/lib/siteApi";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { InteractionManager, Platform } from "react-native";

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
/** Lets the root layout / auth finish mounting before deep-link navigation (cold start). */
const NOTIFICATION_NAV_DELAY_MS = 450;

function schedulePostLoadNavigation(action: () => void) {
  const task = InteractionManager.runAfterInteractions(() => {
    setTimeout(action, NOTIFICATION_NAV_DELAY_MS);
  });
  return task;
}

export function usePushRegistration(accessToken: string | null) {
  const lastSent = useRef<string | null>(null);
  const router = useRouter();

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const kind = String(data?.kind || "").trim();

      const roomIdRaw = data?.room_id;
      const roomSlugRaw = data?.room_slug;
      const roomId =
        typeof roomIdRaw === "string"
          ? roomIdRaw.trim()
          : roomIdRaw != null
            ? String(roomIdRaw).trim()
            : "";
      const roomSlug =
        typeof roomSlugRaw === "string"
          ? roomSlugRaw.trim()
          : roomSlugRaw != null
            ? String(roomSlugRaw).trim()
            : "";

      const navigate = () => {
        if (kind === "pickup_invite" || kind === "pickup_likely_on" || kind === "pickup_confirmed") {
          router.push("/(tabs)/runs" as const);
          return;
        }
        if (kind === "admin_availability") {
          router.push("/admin/pickup" as const);
          return;
        }
        if (kind === "chat_message") {
          if (roomId) {
            router.push({ pathname: "/(tabs)/messages/thread", params: { id: roomId } } as const);
          } else if (roomSlug) {
            router.push({ pathname: "/(tabs)/messages/thread", params: { slug: roomSlug } } as const);
          } else {
            router.push("/(tabs)/messages" as const);
          }
          return;
        }
        if (kind === "tournament_invite") {
          router.push("/(tabs)/tournaments" as const);
          return;
        }
        if (kind === "roster_invite") {
          router.push("/field-tournament" as const);
          return;
        }
      };

      if (!kind) return;
      schedulePostLoadNavigation(navigate);
    },
    [router],
  );

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => sub.remove();
  }, [handleNotificationResponse]);

  useEffect(() => {
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      handleNotificationResponse(response);
    });
    return () => {
      cancelled = true;
    };
  }, [handleNotificationResponse]);

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
