import * as Location from "expo-location";
import { Alert } from "react-native";

import { appAsyncStorage } from "@/lib/appAsyncStorage";

const DECLINED_KEY = "ctpickup_location_explainer_declined_v1";

export type LocationAccess = "granted" | "declined" | "denied";

/**
 * Foreground location, with a one-line explanation before the first system prompt.
 *   granted:  already allowed, or allowed just now.
 *   declined: the player tapped "Not now" on the explanation (no system prompt was shown).
 *   denied:   the system prompt was refused, or location was already denied in Settings.
 * With `auto` (a screen asking on open), a player who already said "Not now" is not asked again; a button they
 * tap themselves always asks.
 */
export async function requestLocationWithExplainer(opts?: { auto?: boolean }): Promise<LocationAccess> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === "granted") return "granted";
  if (current.status !== "undetermined") return "denied";

  if (opts?.auto) {
    try {
      if ((await appAsyncStorage.getItem(DECLINED_KEY)) === "1") return "declined";
    } catch {
      /* ask */
    }
  }

  const proceed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      "Use your location to find games near you",
      undefined,
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
  if (!proceed) {
    try {
      await appAsyncStorage.setItem(DECLINED_KEY, "1");
    } catch {
      /* ignore */
    }
    return "declined";
  }

  const req = await Location.requestForegroundPermissionsAsync();
  return req.status === "granted" ? "granted" : "denied";
}
