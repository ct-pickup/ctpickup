import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { hapticError } from "@/lib/haptics";
import * as Sentry from "@sentry/react-native";
import { pickupPlayerRefundEligibleClient, type PickupRunRefundTiming } from "@/lib/pickupRefundEligibility";
import { postPickupCommit, postPickupPay, postPickupRsvp } from "@/lib/siteApi";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";

let cancellationPolicyShownThisSession = false;

function confirmCancellationPolicy(): Promise<boolean> {
  if (cancellationPolicyShownThisSession) return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert(
      "Cancellation Policy",
      "If this run is cancelled, you will receive a credit for the exact amount you paid, valid for 3 months — no fees deducted.",
      [
        {
          text: "OK",
          onPress: () => {
            cancellationPolicyShownThisSession = true;
            resolve(true);
          },
        },
      ],
      { cancelable: false },
    );
  });
}

/**
 * Field fees use Stripe Checkout (hosted). That is not the CT Pickup marketing site.
 * Free RSVPs stay entirely inside the app.
 */
function confirmPhysicalPaymentCheckout(venueLabel: string): Promise<boolean> {
  const venue = venueLabel.trim() || "the scheduled venue";
  return new Promise((resolve) => {
    Alert.alert(
      "Physical session payment",
      `Payment is for a physical soccer session at ${venue}. This is not a digital purchase.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue to payment", onPress: () => resolve(true) },
      ],
    );
  });
}

/** Opens browser after showing the physical-payment confirmation. Does NOT show the cancellation policy. */
async function openBrowserWithPhysicalConfirm(
  url: string,
  venueLabel: string,
  onReturn?: () => void | Promise<void>,
) {
  const confirmed = await confirmPhysicalPaymentCheckout(venueLabel);
  if (!confirmed) return;

  const sub = Linking.addEventListener("url", (event) => {
    const u = event.url || "";
    if (u.startsWith("ctpickup://pickup")) {
      void onReturn?.();
    }
  });
  try {
    await WebBrowser.openBrowserAsync(url);
  } finally {
    sub.remove();
  }
}

/** Full checkout open: cancellation policy + physical-payment confirm + browser. Used by payPickup. */
async function openStripeCheckout(
  url: string,
  venueLabel: string,
  onReturn?: () => void | Promise<void>,
) {
  const policyOk = await confirmCancellationPolicy();
  if (!policyOk) return;
  await openBrowserWithPhysicalConfirm(url, venueLabel, onReturn);
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

/** Maps `/api/pickup/rsvp` decline errors to a user-readable message. */
function rsvpDeclineErrorMessage(status: number, j: Record<string, unknown>): string {
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
  return `Could not record your response (${status}).`;
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

type PhotoModalState = {
  resolve: (photoPackage: boolean) => void;
  runName: string | null;
  feeCents: number;
};

export function usePickupJoin() {
  const { region } = useSelectedRegion();
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
  const [photoModalState, setPhotoModalState] = useState<PhotoModalState | null>(null);
  // Keep a ref so the confirm callback doesn’t close over stale state
  const photoModalResolveRef = useRef<((v: boolean) => void) | null>(null);

  const onPhotoModalConfirm = useCallback((photoPackage: boolean) => {
    photoModalResolveRef.current?.(photoPackage);
    photoModalResolveRef.current = null;
    setPhotoModalState(null);
  }, []);

  const promptPhotoPackage = useCallback(
    (runName: string | null, feeCents: number): Promise<boolean> =>
      new Promise((resolve) => {
        photoModalResolveRef.current = resolve;
        setPhotoModalState({ resolve, runName, feeCents });
      }),
    [],
  );

  const joinPickup = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      reload: () => void | Promise<void>,
      options?: { friendUserId?: string; friendDisplayName?: string; venueName?: string; runName?: string; feeCents?: number },
    ) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) {
        void hapticError();
        Alert.alert("No featured run", "There isn’t a promoted pickup to join yet. Try again later.");
        return;
      }
      const friendId = typeof options?.friendUserId === "string" ? options.friendUserId.trim() : "";
      const friendName =
        typeof options?.friendDisplayName === "string" && options.friendDisplayName.trim().length > 0
          ? options.friendDisplayName.trim()
          : null;
      const payForFriend = friendId.length > 0;
      setJoinBusy(true);
      try {
        // Show cancellation policy before the API call so photo_package choice can be included.
        const policyOk = await confirmCancellationPolicy();
        if (!policyOk) return;

        // Photo package opt-in — skipped for pay-for-friend flows.
        let photoPackage = false;
        if (!payForFriend) {
          const runName = typeof options?.runName === "string" ? options.runName : null;
          const feeCents = typeof options?.feeCents === "number" ? options.feeCents : 0;
          photoPackage = await promptPhotoPackage(runName, feeCents);
        }

        const r = await postPickupRsvp(accessToken, id, "join", {
          ...(payForFriend ? { friend_user_id: friendId } : {}),
          ...(photoPackage ? { photo_package: true } : {}),
          checkout_return: "mobile",
        });
        const j = r.json as Record<string, unknown>;
        if (r.ok && typeof j.checkout_url === "string" && j.checkout_url.startsWith("https://")) {
          const venueName =
            typeof options?.venueName === "string" && options.venueName.trim()
              ? options.venueName.trim()
              : "the scheduled venue";
          // Policy already shown above; skip to physical confirm + browser.
          await openBrowserWithPhysicalConfirm(j.checkout_url, venueName, reload);
          await reload();
          return;
        }
        if (r.ok) {
          const st = typeof j.status === "string" ? j.status : "";
          const title = "Pickup";
          const body =
            st === "confirmed"
              ? payForFriend && friendName
                ? `${friendName} is confirmed for this run.`
                : "You’re confirmed for this run."
              : st === "standby" || st === "waitlist"
                ? payForFriend && friendName
                  ? `${friendName} was added to the waitlist.`
                  : "You were added to the waitlist."
                : st === "pending_confirm"
                  ? payForFriend && friendName
                    ? `${friendName} has a spot to confirm — finish checkout to secure it.`
                    : "A spot opened — confirm now before your offer expires."
                  : st === "pending_payment"
                    ? payForFriend && friendName
                      ? `Checkout started for ${friendName}. They’ll show as confirmed after payment completes.`
                      : "Payment recorded reopen this screen if status looks stale."
                    : payForFriend && friendName
                      ? `${friendName}’s RSVP was updated.`
                      : "Your RSVP was updated.";
          Alert.alert(title, body);
          await reload();
          return;
        }
        if (j.error === "friend_waiver_required") {
          const detail = typeof j.detail === "string" ? j.detail : "That player must accept the waiver first.";
          void hapticError();
          Alert.alert("Waiver required", detail);
          return;
        }
        const rawErr = typeof j.error === "string" ? j.error : "";
        const isLocked =
          /already started/i.test(rawErr) || /run has already started/i.test(String(j.detail || ""));
        if (isLocked) {
          void hapticError();
          Alert.alert("Joining closed", "This run has already started.");
          await reload();
          return;
        }
        const msg = rawErr || `Could not join (${r.status}).`;
        void hapticError();
        Alert.alert("Can’t join this run", msg);
      } catch (e) {
        void hapticError();
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[pickup join] joinPickup failed", e);
        Sentry.captureException(e);
        Alert.alert("Something went wrong", msg || "Please try again.");
      } finally {
        setJoinBusy(false);
      }
    },
    [],
  );

  const payPickup = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      reload: () => void | Promise<void>,
      options?: { venueName?: string },
    ) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) {
        void hapticError();
        Alert.alert("No featured run", "There isn’t a promoted pickup to pay for yet.");
        return;
      }
      setPayBusy(true);
      try {
        const r = await postPickupPay(accessToken, id, { checkout_return: "mobile" });
        const j = r.json as Record<string, unknown>;
        if (r.ok && typeof j.url === "string" && j.url.startsWith("https://")) {
          const venueName =
            typeof options?.venueName === "string" && options.venueName.trim()
              ? options.venueName.trim()
              : "the scheduled venue";
          await openStripeCheckout(j.url, venueName, reload);
          await reload();
          return;
        }
        void hapticError();
        Alert.alert("Can’t complete payment", payErrorMessage(r.status, j));
      } catch (e) {
        void hapticError();
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[pickup join] payPickup failed", e);
        Sentry.captureException(e);
        Alert.alert("Something went wrong", msg || "Please try again.");
      } finally {
        setPayBusy(false);
      }
    },
    [],
  );

  const declinePickup = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      run: PickupRunRefundTiming | null | undefined,
      reload: () => void | Promise<void>,
    ) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) return;

      const refundEligible = pickupPlayerRefundEligibleClient(run ?? {});
      const title = "Cancel your spot?";
      const message = refundEligible
        ? "You will receive a full refund since you are canceling more than 24 hours before the run."
        : "The 24-hour cancellation window has passed. You will not receive a refund.";
      const proceedLabel = refundEligible ? "Cancel & get refund" : "Cancel spot";

      Alert.alert(title, message, [
        { text: "Keep my spot", style: "cancel" },
        {
          text: proceedLabel,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeclineBusy(true);
              try {
                const r = await postPickupRsvp(accessToken, id, "decline");
                const j = r.json as Record<string, unknown>;
                if (r.ok) {
                  await reload();
                  return;
                }
                const msg = typeof j.error === "string" ? j.error : `Could not cancel spot (${r.status}).`;
                void hapticError();
                Alert.alert("Could not cancel", msg);
              } finally {
                setDeclineBusy(false);
              }
            })();
          },
        },
      ]);
    },
    [],
  );

  /** "Can't make it?" — planning poll uses availability; open RSVP uses pickup_run_rsvps. */
  const recordCantMakeIt = useCallback(
    async (
      accessToken: string | null,
      runId: unknown,
      runStatus: string | null,
      finalSlotId: unknown,
      reload: () => void | Promise<void>,
    ) => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) return;

      const st = (runStatus || "").trim().toLowerCase();
      const useAvailabilityCommit =
        (st === "planning" || st === "likely_on") && (finalSlotId == null || finalSlotId === "");

      setAvailabilityBusy(true);
      try {
        if (useAvailabilityCommit) {
          const r = await postPickupCommit(accessToken, id, "declined", null, null, null, region);
          const j = r.json as Record<string, unknown>;
          if (r.ok) {
            await reload();
            return;
          }
          void hapticError();
          Alert.alert("Could not save", commitErrorMessage(r.status, j));
          return;
        }

        const r = await postPickupRsvp(accessToken, id, "decline");
        const j = r.json as Record<string, unknown>;
        if (r.ok) {
          await reload();
          return;
        }
        void hapticError();
        Alert.alert("Could not save", rsvpDeclineErrorMessage(r.status, j));
      } catch (e) {
        void hapticError();
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[pickup join] recordCantMakeIt failed", e);
        Sentry.captureException(e);
        Alert.alert("Something went wrong", msg || "Please try again.");
      } finally {
        setAvailabilityBusy(false);
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
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return;
      }
      if (!id) return;
      setAvailabilityBusy(true);
      setPendingSlotKey(state === "available" ? (slotLabel ?? slotId) : null);
      try {
        const r = await postPickupCommit(accessToken, id, state, slotId, slotLabel, null, region);
        const j = r.json as Record<string, unknown>;
        if (r.ok) {
          await reload();
          return;
        }
        void hapticError();
        Alert.alert("Could not submit", commitErrorMessage(r.status, j));
      } catch (e) {
        void hapticError();
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[pickup join] commitAvailability failed", e);
        Sentry.captureException(e);
        Alert.alert("Something went wrong", msg || "Please try again.");
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
      selections: { slotId: string | null; label: string }[],
      reload: () => void | Promise<void>,
    ): Promise<boolean> => {
      const id = typeof runId === "string" ? runId : null;
      if (!accessToken) {
        void hapticError();
        Alert.alert("Session required", "Sign in on this device, then try again.");
        return false;
      }
      if (!id) return false;
      const slotLabels = selections.map((s) => s.label).sort();
      setAvailabilityBusy(true);
      setPendingSlotKey("multi");
      try {
        for (const sel of selections) {
          const r = await postPickupCommit(
            accessToken,
            id,
            "available",
            sel.slotId,
            sel.label,
            slotLabels,
            region,
          );
          const j = r.json as Record<string, unknown>;
          if (!r.ok) {
            void hapticError();
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
    recordCantMakeIt,
    commitAvailability,
    commitAvailabilitySlots,
    pendingSlotKey,
    photoPackageModalProps: {
      visible: !!photoModalState,
      runName: photoModalState?.runName ?? null,
      feeCents: photoModalState?.feeCents ?? 0,
      onConfirm: onPhotoModalConfirm,
    },
  };
}
