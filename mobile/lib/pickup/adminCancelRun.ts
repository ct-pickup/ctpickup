import { postAdminCancelRun, type AdminCancelRunResponse } from "@/lib/adminApi";
import { hapticTap } from "@/lib/haptics";
import { Alert } from "react-native";

/** Confirms, then cancels the run through the admin cancel route, which refunds, credits and notifies every player. */
export function confirmAdminCancelRun(opts: {
  token: string;
  runId: string;
  setActionBusy: (busy: boolean) => void;
  onCancelled: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { token, runId, setActionBusy, onCancelled, onRefresh } = opts;
  Alert.alert(
    "Cancel run?",
    "All players will be notified. Card payments are refunded to the card and players who joined with a credit get it back as a credit. This cannot be undone.",
    [
      { text: "Keep run", style: "cancel" },
      {
        text: "Cancel run",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setActionBusy(true);
            const r = await postAdminCancelRun(token, {
              run_id: runId,
              reason: "Canceled from mobile admin",
            });
            setActionBusy(false);
            if (!r.ok) {
              const detail = (r.detail ?? null) as AdminCancelRunResponse | null;
              const failures = detail?.failures ?? [];
              if (failures.length > 0) {
                const done: string[] = [];
                if (detail?.refunded) done.push(`${detail.refunded} card refund${detail.refunded === 1 ? "" : "s"} issued.`);
                if (detail?.credited) done.push(`${detail.credited} credit${detail.credited === 1 ? "" : "s"} issued.`);
                const lines = failures.map((f) => `• ${f.name ?? "A player"}: ${f.error}`);
                const summary = [detail?.error, ...done].filter(Boolean).join(" ");
                Alert.alert("Some players were not refunded", `${summary}\n\n${lines.join("\n")}`);
                await onRefresh();
              } else {
                Alert.alert("Could not cancel", r.error);
              }
              return;
            }
            void hapticTap();
            const parts = ["All players have been notified."];
            if (r.data?.refunded) parts.push(`${r.data.refunded} card refund${r.data.refunded === 1 ? "" : "s"} issued.`);
            if (r.data?.credited) parts.push(`${r.data.credited} credit${r.data.credited === 1 ? "" : "s"} issued.`);
            Alert.alert("Run cancelled", parts.join(" "));
            onCancelled();
            await onRefresh();
          })();
        },
      },
    ],
  );
}
