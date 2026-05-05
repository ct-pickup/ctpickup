import { postPickupCommit, postPickupPay, postPickupRsvp } from "@/lib/siteApi";
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

/** Server-side `/api/pickup/pay` returns `waiver_required` / `standing_not_eligible` (with `detail`); fall back to a generic message otherwise. */
function payErrorMessage(status: number, j: Record<string, unknown>): string {
  const error = typeof j.error === "string" ? j.error : "";
  const detail = typeof j.detail === "string" ? j.detail : "";
  if (error === "waiver_required") {
    return "Please accept the waiver on the CT Pickup site, then return here to complete payment.";
  }
  if (error === "standing_not_eligible") {
    return detail || "Pickup participation is not available for your account right now.";
  }
  if (detail) return detail;
  if (error) return error;
  return `Could not start checkout (${status}).`;
}

/** Maps `/api/pickup/commit` errors to a user-readable message; falls back to a generic line. */
function commitErrorMessage(status: number, j: Record<string, unknown>): string {
  const error = typeof j.error === "string" ? j.error : "";
  const detail = typeof j.detail === "string" ? j.detail : "";
  if (error === "waiver_required") {
    return "Please accept the waiver on the CT Pickup site, then try again.";
  }
  if (error === "standing_not_eligible") {
    return detail || "Pickup participation is not available for your account right now.";
  }
  if (detail) return detail;
  if (error) return error;
  return `Could not submit availability (${status}).`;
}

export function usePickupJoin() {
  const [joinBusy, setJoinBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  /**
   * Tracks which slot the user is currently committing to so the row can show a
   * spinner. Holds a `slot_id` when the legacy id-based call is used, or a
   * `slot_label` when the fixed-range buttons drive the commit.
   */
  const [pendingSlotKey, setPendingSlotKey] = useState<string | null>(null);

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
                ? "You’re on standby we’ll notify you if a spot opens."
                : st === "pending_payment"
                  ? "Payment recorded reopen this screen if status looks stale."
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

  const payPickup = useCallback(
    async (accessToken: string | null, runId: unknown, reload: () => void | Promise<void>) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) {
        Alert.alert("No featured run", "There isn’t a promoted pickup to pay for yet.");
        return;
      }
      setPayBusy(true);
      try {
        const r = await postPickupPay(accessToken, id);
        const j = r.json as Record<string, unknown>;
        if (r.ok && typeof j.url === "string" && j.url.startsWith("https://")) {
          await openStripeCheckout(j.url);
          await reload();
          return;
        }
        Alert.alert("Can’t complete payment", payErrorMessage(r.status, j));
      } finally {
        setPayBusy(false);
      }
    },
    [],
  );

  const declinePickup = useCallback(
    async (accessToken: string | null, runId: unknown, reload: () => void | Promise<void>) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) return;
      setDeclineBusy(true);
      try {
        const r = await postPickupRsvp(accessToken, id, "decline");
        const j = r.json as Record<string, unknown>;
        if (r.ok) {
          await reload();
          return;
        }
        const msg = typeof j.error === "string" ? j.error : `Could not cancel spot (${r.status}).`;
        Alert.alert("Could not cancel", msg);
      } finally {
        setDeclineBusy(false);
      }
    },
    [],
  );

  const commitAvailability = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      state: "available" | "declined",
      slotId: string | null,
      reload: () => void | Promise<void>,
      slotLabel: string | null = null,
    ) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) return;
      setAvailabilityBusy(true);
      setPendingSlotKey(state === "available" ? (slotLabel ?? slotId) : null);
      try {
        const r = await postPickupCommit(accessToken, id, state, slotId, slotLabel, null);
        const j = r.json as Record<string, unknown>;
        if (r.ok) {
          await reload();
          return;
        }
        Alert.alert("Could not submit", commitErrorMessage(r.status, j));
      } finally {
        setAvailabilityBusy(false);
        setPendingSlotKey(null);
      }
    },
    [],
  );

  const commitAvailabilitySlots = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      slotLabels: string[],
      reload: () => void | Promise<void>,
    ): Promise<boolean> => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return false;
      }
      if (!id) return false;
      setAvailabilityBusy(true);
      setPendingSlotKey("multi");
      try {
        for (const label of slotLabels) {
          const r = await postPickupCommit(accessToken, id, "available", null, label, slotLabels);
          const j = r.json as Record<string, unknown>;
          if (!r.ok) {
            Alert.alert("Could not submit", commitErrorMessage(r.status, j));
            return false;
          }
        }
        await reload();
        return true;
      } finally {
        setAvailabilityBusy(false);
        setPendingSlotKey(null);
      }
    },
    [],
  );

  return {
    joinBusy,
    joinPickup,
    payBusy,
    payPickup,
    declineBusy,
    declinePickup,
    availabilityBusy,
    commitAvailability,
    commitAvailabilitySlots,
    pendingSlotKey,
  };
}
