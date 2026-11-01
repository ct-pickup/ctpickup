import { useAuth } from "@/context/AuthContext";
import { autoBalanceTeams, teamBalanceLine, type BalancePlayer, type PickupTeam } from "@/lib/pickupTeamBalance";
import { fetchPlayerCards } from "@/lib/starRatings";
import { hapticTap } from "@/lib/haptics";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useRef, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

  const { supabase } = useAuth();
  const [totalTeams, setTotalTeams] = useState<2 | 3>(2);
  const [teamByUser, setTeamByUser] = useState<Record<string, PickupTeam>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  // True once the admin has moved anyone by hand; a late-arriving rating never overwrites their choices.
  const touched = useRef(false);

  // Players with their exact rating (display decimal, else the half star). Unrated players stay unrated and count as the field average.
  const rated: BalancePlayer[] = useMemo(
    () => players.map((p) => ({ id: p.id, playing_position: p.playing_position, rating: ratings[p.id] ?? null })),
    [players, ratings],
  );

  useEffect(() => {
    if (!visible) return;
    touched.current = false;
    setTotalTeams(2);
    setRatings({});
    setTeamByUser(autoBalanceTeams(players, 2));
    if (!supabase || players.length === 0) return;
    let live = true;
    void fetchPlayerCards(supabase, players.map((p) => p.id), { withExact: true }).then((cards) => {
      if (!live) return;
      const next: Record<string, number> = {};
      for (const [id, c] of cards) next[id] = c.exact ?? c.star;
      setRatings(next);
    });
    return () => {
      live = false;
    };
  }, [visible, players, supabase]);

  // Ratings arrived: balance again with them, unless the admin already changed something.
  useEffect(() => {
    if (!visible || touched.current || Object.keys(ratings).length === 0) return;
    setTeamByUser(autoBalanceTeams(rated, totalTeams));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratings]);

  const teams: PickupTeam[] = totalTeams === 3 ? ["A", "B", "C"] : ["A", "B"];
  // Admin only: how even the teams are right now, including after manual changes.
  const balanceLine = teamBalanceLine(rated, teamByUser, totalTeams);

  function rebalanceTeams() {
    void hapticTap();
    touched.current = false;
    setTeamByUser(autoBalanceTeams(rated, totalTeams));
  }

  function setPlayerTeam(userId: string, team: PickupTeam) {
    touched.current = true;
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
              <FontAwesome name="times" size={20} color={themeColor().text} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Auto-balance by position and rating, or tap a team chip to reassign.</Text>
          <View style={styles.teamToggleRow}>
            {([2, 3] as const).map((n) => {
              const active = totalTeams === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    void hapticTap();
                    setTotalTeams(n);
                    touched.current = false;
                    setTeamByUser(autoBalanceTeams(rated, n));
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
          {balanceLine ? <Text style={styles.balanceLine}>{balanceLine}</Text> : null}
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

function make_styles() {
  return StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: themeColor().scrim },
  sheet: {
    maxHeight: "88%",
    backgroundColor: themeColor().bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  teamsSheet: { minHeight: "55%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: themeColor().text, fontSize: 20, ...headline },
  subtitle: { color: themeColor().muted, lineHeight: 20, marginBottom: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  balanceLine: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginBottom: 10 },
  teamToggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" },
  teamToggle: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  teamToggleActive: { borderColor: themeColor().pitchText, backgroundColor: themeColor().pitchPanel },
  teamToggleText: { color: themeColor().muted, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  teamToggleTextActive: { color: themeColor().pitchText },
  rebalanceBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().pitchText,
  },
  rebalanceText: { color: themeColor().pitchText, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  teamList: { maxHeight: 360, marginBottom: 12 },
  teamPlayerRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  teamPlayerInfo: { marginBottom: 8 },
  teamPlayerName: { color: themeColor().text, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  teamPlayerPos: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  teamPickRow: { flexDirection: "row", gap: 8 },
  teamChip: {
    minWidth: 40,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
  },
  teamChipActive: { borderColor: themeColor().pitchText, backgroundColor: themeColor().pitchPanel },
  teamChipText: { color: themeColor().muted, fontWeight: "800" },
  teamChipTextActive: { color: themeColor().pitchText },
  primaryBtn: {
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

