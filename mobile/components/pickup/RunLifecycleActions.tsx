import {
  showBeginPickupButton,
  showEditSettingsButton,
  showFinalizeTimeButton,
  showInvitePlayersButton,
  showLaunchOutreachButton,
  showLaunchWaveInvitesButton,
  showPostResultsDuringRun,
  showPromoteToHubDuringPlanning,
} from "@/lib/pickupRunLifecycle";
import { hapticTap } from "@/lib/haptics";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type RunLifecycleAction =
  | "promote_hub"
  | "finalize_slot"
  | "launch_wave_invites"
  | "launch_outreach"
  | "invite_players"
  | "begin_pickup"
  | "post_results"
  | "edit_run"
  | "cancel_run";

export type RunLifecycleActionsProps = {
  run: Record<string, unknown>;
  actionBusy: boolean;
  onAction: (action: RunLifecycleAction) => void;
};

function isCanceled(run: Record<string, unknown>): boolean {
  return s(run.status).trim() === "canceled";
}

export default function RunLifecycleActions({ run, actionBusy, onAction }: RunLifecycleActionsProps) {
  const lifecycleRow = useMemo(
    () => ({
      status: s(run.status) || null,
      is_current: run.is_current === true,
      is_completed: run.is_completed === true,
      final_slot_id: run.final_slot_id != null ? s(run.final_slot_id) : null,
      has_result: run.has_result === true,
      run_type: run.run_type,
      outreach_started_at:
        run.outreach_started_at != null && s(run.outreach_started_at).trim()
          ? s(run.outreach_started_at)
          : null,
    }),
    [run],
  );

  const showPromote = showPromoteToHubDuringPlanning(lifecycleRow);
  const showFinalize = showFinalizeTimeButton(lifecycleRow);
  const showBegin = showBeginPickupButton(lifecycleRow);
  const showPostResults = showPostResultsDuringRun(lifecycleRow);
  const showEdit = showEditSettingsButton(lifecycleRow);
  const showLaunchWave = showLaunchWaveInvitesButton(lifecycleRow);
  const showLaunchOutreach = showLaunchOutreachButton(lifecycleRow);
  const showInvite = showInvitePlayersButton(lifecycleRow);
  const showCancel = !isCanceled(run) && run.is_completed !== true;

  function press(action: RunLifecycleAction) {
    void hapticTap();
    onAction(action);
  }

  return (
    <View style={styles.wrap}>
      {(showPromote || showFinalize) && (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Planning</Text>
          {showPromote ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("promote_hub")}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.primaryBtnText}>Promote to Hub</Text>
            </Pressable>
          ) : null}
          {showFinalize ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("finalize_slot")}
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.secondaryBtnText}>Finalize Time Slot</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {(showLaunchWave || showLaunchOutreach || showInvite) && (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Outreach</Text>
          {showLaunchWave ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("launch_wave_invites")}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.primaryBtnText}>Launch Wave Invites</Text>
            </Pressable>
          ) : null}
          {showLaunchOutreach ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("launch_outreach")}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.primaryBtnText}>Launch Outreach</Text>
            </Pressable>
          ) : null}
          {showInvite ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("invite_players")}
              style={({ pressed }) => [
                showLaunchWave || showLaunchOutreach ? styles.secondaryBtn : styles.primaryBtn,
                pressed && { opacity: 0.9 },
                actionBusy && styles.disabled,
              ]}
            >
              <Text
                style={
                  showLaunchWave || showLaunchOutreach ? styles.secondaryBtnText : styles.primaryBtnText
                }
              >
                {lifecycleRow.outreach_started_at ? "Invite More Players" : "Invite Players"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {showBegin ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Active</Text>
          <Pressable
            disabled={actionBusy}
            onPress={() => press("begin_pickup")}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
          >
            <Text style={styles.primaryBtnText}>Begin Pickup Now</Text>
          </Pressable>
        </View>
      ) : null}

      {showPostResults ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>In progress</Text>
          <Pressable
            disabled={actionBusy}
            onPress={() => press("post_results")}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
          >
            <Text style={styles.primaryBtnText}>Post Results</Text>
          </Pressable>
        </View>
      ) : null}

      {(showEdit || showCancel) && (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Run settings</Text>
          {showEdit ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("edit_run")}
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.secondaryBtnText}>Edit Run</Text>
            </Pressable>
          ) : null}
          {showCancel ? (
            <Pressable
              disabled={actionBusy}
              onPress={() => press("cancel_run")}
              style={({ pressed }) => [styles.destructiveBtn, pressed && { opacity: 0.9 }, actionBusy && styles.disabled]}
            >
              <Text style={styles.destructiveBtnText}>Cancel Run</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20, gap: 16 },
  group: { gap: 10 },
  groupLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  primaryBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  destructiveBtn: {
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.5)",
  },
  disabled: { opacity: 0.55 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  secondaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  destructiveBtnText: { color: "#fca5a5", fontWeight: "700", fontSize: 15 },
});
