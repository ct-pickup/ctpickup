import EditRunSheet from "@/components/pickup/EditRunSheet";
import FinalizeSlotSheet from "@/components/pickup/FinalizeSlotSheet";
import RunLifecycleActions, { type RunLifecycleAction } from "@/components/pickup/RunLifecycleActions";
import TeamAssignmentSheet from "@/components/pickup/TeamAssignmentSheet";
import {
  postAdminAssignPickupTeams,
  postAdminCancelRun,
  postAdminPickupSwitch,
  postAdminSetHubPickup,
  type PickupSwitchDetailResponse,
} from "@/lib/adminApi";
import { hapticGoal, hapticTap } from "@/lib/haptics";
import { isPublicPickupRunType } from "@/lib/pickupRunType";
import type { PickupTeam } from "@/lib/pickupTeamBalance";
import type { Router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

type Props = {
  token: string | null;
  run: Record<string, unknown>;
  detail: PickupSwitchDetailResponse;
  router: Router;
  actionBusy: boolean;
  setActionBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onCloseDetail: () => void;
};

export default function AdminRunDetailLifecycle({
  token,
  run,
  detail,
  router,
  actionBusy,
  setActionBusy,
  onRefresh,
  onCloseDetail,
}: Props) {
  const runId = s(run.id);
  const status = s(run.status).trim();
  const confirmed = Array.isArray(detail.confirmed) ? detail.confirmed : [];
  const slots = Array.isArray(detail.slots) ? detail.slots : [];
  const availability = Array.isArray(detail.availability) ? detail.availability : [];

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState("");

  const [teamsOpen, setTeamsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function onPromoteToHub() {
    if (!token || !runId) return;
    Alert.alert(
      "Promote to hub?",
      "This run will appear on the regional pickup hub for all players in the area.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Promote",
          onPress: () => {
            void (async () => {
              setActionBusy(true);
              const r = await postAdminSetHubPickup(token, runId);
              setActionBusy(false);
              if (!r.ok) {
                Alert.alert("Could not promote", r.error);
                return;
              }
              void hapticGoal();
              await onRefresh();
            })();
          },
        },
      ],
    );
  }

  async function onFinalizeSlot() {
    if (!token || !runId || !selectedSlotId) return;
    setActionBusy(true);
    const r = await postAdminPickupSwitch(token, {
      action: "finalize_slot",
      run_id: runId,
      slot_id: selectedSlotId,
    });
    setActionBusy(false);
    if (!r.ok) {
      Alert.alert("Could not finalize", r.error);
      return;
    }
    void hapticGoal();
    setFinalizeOpen(false);
    setSelectedSlotId("");
    await onRefresh();
  }

  async function onLockTeams(
    assignments: { user_id: string; team: PickupTeam }[],
    totalTeams: 2 | 3,
  ) {
    if (!token || !runId) return;
    setActionBusy(true);
    const assignRes = await postAdminAssignPickupTeams(token, {
      run_id: runId,
      total_teams: totalTeams,
      team_assignments: assignments,
    });
    if (!assignRes.ok) {
      setActionBusy(false);
      Alert.alert("Could not save teams", assignRes.error);
      return;
    }
    const startRes = await postAdminPickupSwitch(token, {
      action: "start_run_now",
      run_id: runId,
    });
    setActionBusy(false);
    if (!startRes.ok) {
      Alert.alert(
        "Teams saved",
        startRes.error || "Could not start run. Try again from the detail sheet.",
      );
      setTeamsOpen(false);
      await onRefresh();
      return;
    }
    void hapticGoal();
    setTeamsOpen(false);
    await onRefresh();
  }

  async function onSaveEdit(payload: { start_at: string; capacity: number; fee_cents: number }) {
    if (!token || !runId) return;
    const { start_at, capacity, fee_cents } = payload;
    if (!Number.isFinite(capacity) || capacity < 1) {
      Alert.alert("Capacity", "Enter a valid player capacity.");
      return;
    }
    if (!Number.isFinite(fee_cents) || fee_cents < 0) {
      Alert.alert("Fee", "Enter a valid fee per player.");
      return;
    }
    setActionBusy(true);
    const body: Record<string, unknown> = {
      action: "edit_run",
      run_id: runId,
      capacity,
      fee_cents,
      currency: "usd",
      title: s(run.title).trim() || "CT Pickup Run",
      run_type: isPublicPickupRunType(run.run_type) ? "public" : "select",
      location_private: run.location_private != null ? s(run.location_private) : null,
    };
    if (start_at) body.start_at = start_at;
    const r = await postAdminPickupSwitch(token, body);
    setActionBusy(false);
    if (!r.ok) {
      Alert.alert("Could not save", r.error);
      return;
    }
    void hapticTap();
    setEditOpen(false);
    await onRefresh();
  }

  async function onCancelRun() {
    if (!token || !runId) return;
    Alert.alert(
      "Cancel run?",
      "All confirmed players will be refunded when applicable.",
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
                Alert.alert("Could not cancel", r.error);
                return;
              }
              void hapticTap();
              onCloseDetail();
              await onRefresh();
            })();
          },
        },
      ],
    );
  }

  function onLifecycleAction(action: RunLifecycleAction) {
    switch (action) {
      case "promote_hub":
        void onPromoteToHub();
        break;
      case "finalize_slot":
        setSelectedSlotId("");
        setFinalizeOpen(true);
        break;
      case "invite_players":
        router.push(`/admin/invite-players?run_id=${encodeURIComponent(runId)}`);
        break;
      case "begin_pickup":
        if (confirmed.length === 0) {
          Alert.alert("No players", "Need at least one confirmed player before locking teams.");
          return;
        }
        Alert.alert(
          "Begin pickup now?",
          "You will assign teams, then the run locks for new RSVPs.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Continue", onPress: () => setTeamsOpen(true) },
          ],
        );
        break;
      case "post_results":
        onCloseDetail();
        router.push(`/admin/run-result?run_id=${encodeURIComponent(runId)}`);
        break;
      case "edit_run":
        setEditOpen(true);
        break;
      case "cancel_run":
        void onCancelRun();
        break;
      default:
        break;
    }
  }

  return (
    <>
      <RunLifecycleActions run={run} actionBusy={actionBusy} onAction={onLifecycleAction} />

      <FinalizeSlotSheet
        visible={finalizeOpen}
        busy={actionBusy}
        slots={slots}
        availability={availability}
        selectedSlotId={selectedSlotId}
        onSelectSlot={setSelectedSlotId}
        onClose={() => setFinalizeOpen(false)}
        onConfirm={() => void onFinalizeSlot()}
      />

      <TeamAssignmentSheet
        visible={teamsOpen}
        busy={actionBusy}
        players={confirmed}
        onClose={() => setTeamsOpen(false)}
        onLockTeams={(assignments, totalTeams) => void onLockTeams(assignments, totalTeams)}
      />

      <EditRunSheet
        visible={editOpen}
        busy={actionBusy}
        initialStartAt={s(run.start_at)}
        initialCapacity={Number(run.capacity ?? 18) || 18}
        initialFeeCents={Number(run.fee_cents ?? 0) || 0}
        statusLabel={status}
        onClose={() => setEditOpen(false)}
        onSave={(payload) => void onSaveEdit(payload)}
      />
    </>
  );
}
