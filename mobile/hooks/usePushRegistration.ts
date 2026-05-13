import { hapticError, hapticGoal, hapticKick, hapticTap, hapticWhistle } from "@/lib/haptics";
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
 *
 * Opens the matching in-app screen when the user taps a notification; navigation is deferred so cold
 * starts can finish loading the root layout and session.
 */
const NOTIFICATION_NAV_DELAY_MS = 450;

const ROUTABLE_NOTIFICATION_KINDS = new Set([
  "pickup_invite",
  "pickup_likely_on",
  "pickup_confirmed",
  "pickup_finalized",
  "pickup_canceled",
  "pickup_promoted",
  "pickup_waitlist_offer",
  "pickup_result",
  "pickup_award_player",
  "pickup_award_goalie",
  "pickup_award_defender",
  "pickup_award_midfielder",
  "pickup_award_attacker",
  "admin_availability",
  "chat_message",
  "announcement",
  "tournament_invite",
  "roster_invite",
  "tournament_live",
  "tournament_canceled",
  "tournament_bracket_generated",
  "tournament_roster_invite",
  "tournament_roster_response",
  "tournament_join_request",
  "tournament_join_decision",
  "tournament_starts_soon",
  "tournament_captain_payment_confirmed",
  "tournament_captain_claim_admin",
  "tier_suggestions_ready",
]);

const PICKUP_RUN_DEEP_LINK_KINDS = new Set([
  "pickup_invite",
  "pickup_likely_on",
  "pickup_confirmed",
  "pickup_finalized",
  "pickup_promoted",
  "pickup_waitlist_offer",
  "pickup_result",
  "pickup_award_player",
  "pickup_award_goalie",
  "pickup_award_defender",
  "pickup_award_midfielder",
  "pickup_award_attacker",
]);

function pickupRunIdFromNotificationData(data: Record<string, unknown>): string {
  const raw = data?.run_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw != null) return String(raw).trim();
  return "";
}

function tournamentIdFromNotificationData(data: Record<string, unknown>): string {
  const raw = data?.tournament_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw != null) return String(raw).trim();
  return "";
}

function schedulePostLoadNavigation(action: () => void) {
  InteractionManager.runAfterInteractions(() => {
    setTimeout(action, NOTIFICATION_NAV_DELAY_MS);
  });
}

function hapticForForegroundPushKind(kind: string) {
  if (kind === "pickup_invite") void hapticKick();
  else if (kind === "pickup_result" || kind.startsWith("pickup_award_")) void hapticWhistle();
  else if (kind === "pickup_confirmed" || kind === "pickup_finalized" || kind === "pickup_likely_on")
    void hapticGoal();
  else if (kind === "pickup_waitlist_offer" || kind === "pickup_promoted") void hapticKick();
  else if (kind === "pickup_canceled") void hapticError();
  else if (kind === "admin_availability") void hapticTap();
  else if (kind === "chat_message" || kind === "announcement") void hapticTap();
  else if (
    kind === "tournament_invite" ||
    kind === "roster_invite" ||
    kind === "tournament_live" ||
    kind === "tournament_roster_invite"
  )
    void hapticKick();
  else if (kind === "tournament_bracket_generated" || kind === "tournament_starts_soon") void hapticWhistle();
  else if (kind === "tournament_canceled") void hapticError();
  else if (
    kind === "tournament_roster_response" ||
    kind === "tournament_join_request" ||
    kind === "tournament_join_decision" ||
    kind === "tournament_captain_payment_confirmed"
  )
    void hapticGoal();
  else if (kind === "tournament_captain_claim_admin" || kind === "tier_suggestions_ready") void hapticTap();
  else void hapticTap();
}

function hapticForNotificationTap(kind: string) {
  if (
    kind.startsWith("pickup_award_") ||
    kind === "pickup_result" ||
    kind === "tournament_bracket_generated" ||
    kind === "tournament_starts_soon"
  ) {
    void hapticWhistle();
  } else if (kind === "pickup_canceled" || kind === "tournament_canceled") {
    void hapticError();
  } else {
    void hapticTap();
  }
}

export function usePushRegistration(accessToken: string | null) {
  const lastSent = useRef<string | null>(null);
  const router = useRouter();

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const kind = String(data?.kind || "").trim();
      if (!ROUTABLE_NOTIFICATION_KINDS.has(kind)) return;

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
        if (kind === "pickup_canceled") {
          router.push("/(tabs)/runs" as const);
          void hapticForNotificationTap(kind);
          return;
        }
        if (PICKUP_RUN_DEEP_LINK_KINDS.has(kind)) {
          const runId = pickupRunIdFromNotificationData(data);
          if (runId) {
            router.push({ pathname: "/(tabs)/runs", params: { run_id: runId } } as const);
          } else {
            router.push("/(tabs)/runs" as const);
          }
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "admin_availability") {
          router.push("/admin/pickup" as const);
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "chat_message" || kind === "announcement") {
          if (roomId) {
            router.push({ pathname: "/(tabs)/messages/thread", params: { id: roomId } } as const);
          } else if (roomSlug) {
            router.push({ pathname: "/(tabs)/messages/thread", params: { slug: roomSlug } } as const);
          } else {
            router.push("/(tabs)/messages" as const);
          }
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "tournament_bracket_generated") {
          const tid = tournamentIdFromNotificationData(data);
          if (tid) {
            router.push({
              pathname: "/tournament-bracket-view",
              params: { tournament_id: tid },
            } as const);
          } else {
            router.push("/(tabs)/tournaments" as const);
          }
          void hapticForNotificationTap(kind);
          return;
        }
        if (
          kind === "tournament_invite" ||
          kind === "tournament_live" ||
          kind === "tournament_canceled" ||
          kind === "tournament_roster_invite" ||
          kind === "tournament_roster_response" ||
          kind === "tournament_join_request" ||
          kind === "tournament_join_decision" ||
          kind === "tournament_starts_soon" ||
          kind === "tournament_captain_payment_confirmed"
        ) {
          router.push("/(tabs)/tournaments" as const);
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "tournament_captain_claim_admin") {
          router.push("/admin/tournament" as const);
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "tier_suggestions_ready") {
          router.push("/admin/members" as const);
          void hapticForNotificationTap(kind);
          return;
        }
        if (kind === "roster_invite") {
          router.push("/field-tournament" as const);
          void hapticForNotificationTap(kind);
          return;
        }
      };

      schedulePostLoadNavigation(navigate);
    },
    [router],
  );

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      const kind = String(data?.kind || "").trim();
      hapticForForegroundPushKind(kind);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => sub.remove();
  }, [handleNotificationResponse]);

  useEffect(() => {
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        handleNotificationResponse(response);
      })
      .catch((e) => console.warn("[push] cold start replay failed", e));
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
