import { postPickupRsvp } from "@/lib/siteApi";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

/**
 * Field fees use Stripe Checkout (hosted). That is not the CT Pickup marketing site.
 * Free RSVPs stay entirely inside the app.
 */
async function openStripeCheckout(url: string) {
  await WebBrowser.openBrowserAsync(url);
}

export function usePickupJoin() {
  const [joinBusy, setJoinBusy] = useState(false);

  const joinPickup = useCallback(
    async (accessToken: string | null, runId: unknown, reload: () => void | Promise<void>) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) {
        Alert.alert("No featured run", "There isn’t a promoted pickup to join yet. Try again later.");
        return;
      }
      setJoinBusy(true);
      try {
        const r = await postPickupRsvp(accessToken, id, "join");
        const j = r.json as Record<string, unknown>;
        if (r.ok && typeof j.checkout_url === "string" && j.checkout_url.startsWith("https://")) {
          await openStripeCheckout(j.checkout_url);
          await reload();
          return;
        }
        if (r.ok) {
          const st = typeof j.status === "string" ? j.status : "";
          const title = "Pickup";
          const body =
            st === "confirmed"
              ? "You’re confirmed for this run."
              : st === "standby"
                ? "You’re on standby — we’ll notify you if a spot opens."
                : st === "pending_payment"
                  ? "Payment recorded — reopen this screen if status looks stale."
                  : "Your RSVP was updated.";
          Alert.alert(title, body);
          await reload();
          return;
        }
        const msg = typeof j.error === "string" ? j.error : `Could not join (${r.status}).`;
        Alert.alert("Can’t join this run", msg);
      } finally {
        setJoinBusy(false);
      }
    },
    [],
  );

  return { joinBusy, joinPickup };
}
