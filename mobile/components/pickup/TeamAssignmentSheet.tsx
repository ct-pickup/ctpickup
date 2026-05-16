import { autoBalanceTeams, type PickupTeam } from "@/lib/pickupTeamBalance";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const LIME = "#a3e635";

export type TeamAssignmentPlayer = {
  id: string;
  full_name: string | null;
  playing_position?: string | null;
};

export type TeamAssignmentSheetProps = {
  visible: boolean;
  busy: boolean;
  players: TeamAssignmentPlayer[];
  onClose: () => void;
  onLockTeams: (assignments: { user_id: string; team: PickupTeam }[], totalTeams: 2 | 3) => void;
};

export default function TeamAssignmentSheet({
  visible,
  busy,
  players,
  onClose,
  onLockTeams,
}: TeamAssignmentSheetProps) {
  const [totalTeams, setTotalTeams] = useState<2 | 3>(2);
  const [teamByUser, setTeamByUser] = useState<Record<string, PickupTeam>>({});

  useEffect(() => {
    if (!visible) return;
    setTotalTeams(2);
    setTeamByUser(autoBalanceTeams(players, 2));
  }, [visible, players]);

  const teams: PickupTeam[] = totalTeams === 3 ? ["A", "B", "C"] : ["A", "B"];

  function rebalanceTeams() {
    void hapticTap();
    setTeamByUser(autoBalanceTeams(players, totalTeams));
  }

  function setPlayerTeam(userId: string, team: PickupTeam) {
    setTeamByUser((cur) => ({ ...cur, [userId]: team }));
  }

  function onPressLock() {
    const assignments = players.map((p) => ({
      user_id: p.id,
      team: teamByUser[p.id] ?? "A",
    }));
    const missing = players.filter((p) => !teamByUser[p.id]);
    if (missing.length > 0) {
      Alert.alert("Assign teams", "Every confirmed player needs a team.");
      return;
    }
    Alert.alert(
      "Lock teams & begin pickup?",
      "Teams are saved and the run moves to in progress. No new players can join.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock teams",
          onPress: () => onLockTeams(assignments, totalTeams),
        },
      ],
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.sheet, styles.teamsSheet]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Assign teams</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <FontAwesome name="times" size={20} color="#fff" />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Auto-balance by position, or tap a team chip to reassign.</Text>
          <View style={styles.teamToggleRow}>
            {([2, 3] as const).map((n) => {
              const active = totalTeams === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    void hapticTap();
                    setTotalTeams(n);
                    setTeamByUser(autoBalanceTeams(players, n));
                  }}
                  style={({ pressed }) => [styles.teamToggle, active && styles.teamToggleActive, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.teamToggleText, active && styles.teamToggleTextActive]}>{n} teams</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={rebalanceTeams} style={({ pressed }) => [styles.rebalanceBtn, pressed && { opacity: 0.9 }]}>
              <Text style={styles.rebalanceText}>Auto-balance</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.teamList} showsVerticalScrollIndicator={false}>
            {players.map((p) => (
              <View key={p.id} style={styles.teamPlayerRow}>
                <View style={styles.teamPlayerInfo}>
                  <Text style={styles.teamPlayerName}>{p.full_name?.trim() || "Player"}</Text>
                  {p.playing_position ? <Text style={styles.teamPlayerPos}>{p.playing_position}</Text> : null}
                </View>
                <View style={styles.teamPickRow}>
                  {teams.map((t) => {
                    const active = teamByUser[p.id] === t;
                    return (
                      <Pressable
                        key={t}
                        onPress={() => {
                          void hapticTap();
                          setPlayerTeam(p.id, t);
                        }}
                        style={({ pressed }) => [
                          styles.teamChip,
                          active && styles.teamChipActive,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={[styles.teamChipText, active && styles.teamChipTextActive]}>{t}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable
            disabled={busy || players.length === 0}
            onPress={() => {
              void hapticTap();
              onPressLock();
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              (busy || players.length === 0) && styles.primaryBtnDisabled,
              pressed && !busy && players.length > 0 && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.primaryBtnText}>{busy ? "Locking…" : "Lock Teams"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  teamsSheet: { minHeight: "55%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.5)", lineHeight: 20, marginBottom: 12, fontSize: 13 },
  teamToggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" },
  teamToggle: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  teamToggleActive: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.1)" },
  teamToggleText: { color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 13 },
  teamToggleTextActive: { color: LIME },
  rebalanceBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  rebalanceText: { color: LIME, fontWeight: "700", fontSize: 12 },
  teamList: { maxHeight: 360, marginBottom: 12 },
  teamPlayerRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  teamPlayerInfo: { marginBottom: 8 },
  teamPlayerName: { color: "#fff", fontWeight: "700", fontSize: 15 },
  teamPlayerPos: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 },
  teamPickRow: { flexDirection: "row", gap: 8 },
  teamChip: {
    minWidth: 40,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
  },
  teamChipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  teamChipText: { color: "rgba(255,255,255,0.6)", fontWeight: "800" },
  teamChipTextActive: { color: LIME },
  primaryBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
