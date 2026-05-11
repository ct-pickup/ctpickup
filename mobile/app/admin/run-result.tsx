import { useAuth } from "@/context/AuthContext";
import { hapticError, hapticGoal, hapticTap, hapticWhistle } from "@/lib/haptics";
import { fetchAdminPickupSwitchDetail, postAdminPickupResult } from "@/lib/adminApi";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Team = "A" | "B" | "C";

type ConfirmedRow = { id: string; full_name: string | null; playing_position?: string | null };

const TEAMS_2: Team[] = ["A", "B"];
const TEAMS_3: Team[] = ["A", "B", "C"];

type SelectOption<T extends string> = { value: T; label: string };

function labelTeam(t: Team) {
  return `Team ${t}`;
}

function nameFor(p: ConfirmedRow) {
  const n = (p.full_name ?? "").trim();
  return n || p.id;
}

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

function SelectModal<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close picker" />
        <View style={styles.modalCardWrap} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            {options.map((opt) => {
              const selected = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    void hapticTap();
                    onSelect(opt.value);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    selected && styles.modalRowSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.modalRowText, selected && styles.modalRowTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={onClose} style={({ pressed }) => [styles.modalCancel, pressed && { opacity: 0.85 }]}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminRunResultScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { run_id: rawRunId } = useLocalSearchParams<{ run_id?: string | string[] }>();
  const runId = typeof rawRunId === "string" ? rawRunId : Array.isArray(rawRunId) ? rawRunId[0] : "";

  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [region, setRegion] = useState<ServiceRegionCode | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedRow[]>([]);

  const [totalTeams, setTotalTeams] = useState<2 | 3>(2);
  const [winningTeam, setWinningTeam] = useState<Team>("A");
  const [teamByUser, setTeamByUser] = useState<Record<string, Team>>({});

  const [playerOfDay, setPlayerOfDay] = useState<string | null>(null);
  const [defenderOfDay, setDefenderOfDay] = useState<string | null>(null);
  const [midfielderOfDay, setMidfielderOfDay] = useState<string | null>(null);
  const [attackerOfDay, setAttackerOfDay] = useState<string | null>(null);

  const [picker, setPicker] = useState<
    | null
    | { kind: "team"; userId: string }
    | { kind: "winning" }
    | { kind: "award"; which: "player" | "defender" | "midfielder" | "attacker" }
  >(null);

  const [submitting, setSubmitting] = useState(false);

  function generateTeams(players: ConfirmedRow[], numTeams: number): Record<string, Team> {
    const positions = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
    const grouped: Record<string, ConfirmedRow[]> = {};
    for (const pos of positions) grouped[pos] = [];
    const unassigned: ConfirmedRow[] = [];
    for (const p of players) {
      const pos = p.playing_position || "";
      if (positions.includes(pos)) grouped[pos].push(p);
      else unassigned.push(p);
    }
    for (const pos of positions) grouped[pos].sort(() => Math.random() - 0.5);
    unassigned.sort(() => Math.random() - 0.5);
    const allOrdered = [...grouped["Goalkeeper"], ...grouped["Defender"], ...grouped["Midfielder"], ...grouped["Attacker"], ...unassigned];
    const teamLabels: Team[] = numTeams === 3 ? ["A", "B", "C"] : ["A", "B"];
    const result: Record<string, Team> = {};
    allOrdered.forEach((p, i) => {
      result[p.id] = teamLabels[i % numTeams];
    });
    return result;
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Run result",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (!token || !runId) {
      setLoading(false);
      setErr(!token ? "Not signed in." : "Missing run_id.");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      const r = await fetchAdminPickupSwitchDetail(token, runId);
      if (cancelled) return;
      if (!r.ok) {
        setErr(r.error || "Couldn’t load run.");
        setConfirmed([]);
        setRegion(null);
        setLoading(false);
        return;
      }
      const run = r.data.run;
      const regionRaw = run && typeof run === "object" ? (run as Record<string, unknown>).service_region : null;
      const reg = typeof regionRaw === "string" ? (regionRaw.trim().toUpperCase() as ServiceRegionCode) : null;
      setRegion(reg && ["CT", "NY", "NJ", "MD"].includes(reg) ? reg : null);
      const list = Array.isArray(r.data.confirmed) ? (r.data.confirmed as ConfirmedRow[]) : [];
      setConfirmed(list);
      setLoading(false);

      // Default: alternate teams A/B for quick setup.
      setTeamByUser((cur) => {
        if (Object.keys(cur).length) return cur;
        const next: Record<string, Team> = {};
        list.forEach((p, idx) => {
          next[p.id] = idx % 2 === 0 ? "A" : "B";
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, runId]);

  const allowedTeams = totalTeams === 3 ? TEAMS_3 : TEAMS_2;

  useEffect(() => {
    if (allowedTeams.includes(winningTeam)) return;
    setWinningTeam("A");
  }, [totalTeams, winningTeam, allowedTeams]);

  useEffect(() => {
    setTeamByUser((cur) => {
      const next: Record<string, Team> = { ...cur };
      let changed = false;
      for (const [uid, t] of Object.entries(next)) {
        if (!allowedTeams.includes(t)) {
          next[uid] = "A";
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [allowedTeams]);

  const awardOptions = useMemo(() => {
    const opts = confirmed.map((p) => ({ value: p.id, label: nameFor(p) }));
    return [{ value: "" as const, label: "None" }, ...opts] as const;
  }, [confirmed]);

  const teamOptions = useMemo(
    () => allowedTeams.map((t) => ({ value: t, label: labelTeam(t) })),
    [allowedTeams],
  );

  const winningOptions = teamOptions;

  const filledAssignments = useMemo(() => {
    return confirmed
      .map((p) => ({
        user_id: p.id,
        team: teamByUser[p.id] ?? "A",
      }))
      .filter((a) => allowedTeams.includes(a.team));
  }, [confirmed, teamByUser, allowedTeams]);

  const awardWinners = uniq([playerOfDay, defenderOfDay, midfielderOfDay, attackerOfDay].filter(Boolean));
  const awardWinnerNotInConfirmed = awardWinners.some((id) => !confirmed.some((p) => p.id === id));

  async function onSubmit() {
    if (!token) {
      void hapticError();
      return Alert.alert("Not signed in", "Sign in again.");
    }
    if (!runId) {
      void hapticError();
      return Alert.alert("Missing run", "Missing run_id.");
    }
    if (confirmed.length === 0) {
      void hapticError();
      return Alert.alert("No confirmed players", "This run has no confirmed players.");
    }
    if (filledAssignments.length !== confirmed.length) {
      void hapticError();
      return Alert.alert("Missing teams", "Assign a team for each confirmed player.");
    }
    if (awardWinnerNotInConfirmed) {
      void hapticError();
      return Alert.alert("Awards must be from roster", "Award winners must be selected from confirmed players.");
    }

    void hapticGoal();
    setSubmitting(true);
    const r = await postAdminPickupResult(token, {
      run_id: runId,
      total_teams: totalTeams,
      winning_team: winningTeam,
      team_assignments: filledAssignments,
      player_of_day: playerOfDay,
      defender_of_day: defenderOfDay,
      midfielder_of_day: midfielderOfDay,
      attacker_of_day: attackerOfDay,
    });
    setSubmitting(false);

    if (!r.ok) {
      void hapticError();
      Alert.alert("Submit failed", r.error || "Couldn’t save result.");
      return;
    }

    void hapticWhistle();
    Alert.alert("Saved", "Run result recorded and pushes sent.", [
      { text: "Done", onPress: () => router.back() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={LIME} />
      </View>
    );
  }

  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.errText}>{err}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <Text style={styles.h1}>Mark result</Text>
        <Text style={styles.sub}>
          {region ? `Region: ${serviceRegionName(region)}` : "Region: —"}{"\n"}
          Confirmed players: {confirmed.length}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Teams</Text>
      <View style={styles.segmentRow}>
        <Pressable
          onPress={() => {
            void hapticTap();
            setTotalTeams(2);
          }}
          style={({ pressed }) => [styles.segmentChip, totalTeams === 2 && styles.segmentChipActive, pressed && { opacity: 0.9 }]}
        >
          <Text style={[styles.segmentText, totalTeams === 2 && styles.segmentTextActive]}>2 teams</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void hapticTap();
            setTotalTeams(3);
          }}
          style={({ pressed }) => [styles.segmentChip, totalTeams === 3 && styles.segmentChipActive, pressed && { opacity: 0.9 }]}
        >
          <Text style={[styles.segmentText, totalTeams === 3 && styles.segmentTextActive]}>3 teams</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => {
          void hapticTap();
          setTeamByUser(generateTeams(confirmed, totalTeams));
        }}
        style={({ pressed }) => [styles.generateBtn, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.generateBtnText}>⚡ Auto-assign teams by position</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Winning team</Text>
      <Pressable
        onPress={() => {
          void hapticTap();
          setPicker({ kind: "winning" });
        }}
        style={({ pressed }) => [styles.input, styles.selectTrigger, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.selectValue}>{labelTeam(winningTeam)}</Text>
        <Text style={styles.selectChevron}>▾</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Roster assignments</Text>
      <View style={styles.card}>
        {confirmed.length === 0 ? <Text style={styles.muted}>No confirmed players.</Text> : null}
        {confirmed.map((p) => {
          const team = teamByUser[p.id] ?? "A";
          return (
            <View key={p.id} style={styles.rosterRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.personName} numberOfLines={1}>
                  {nameFor(p)}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  void hapticTap();
                  setPicker({ kind: "team", userId: p.id });
                }}
                style={({ pressed }) => [styles.teamPill, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.teamPillText}>{labelTeam(team)}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Awards</Text>
      <View style={styles.card}>
        <AwardRow
          label="Player of the Day"
          valueLabel={playerOfDay ? nameFor(confirmed.find((p) => p.id === playerOfDay) || { id: playerOfDay, full_name: null }) : "None"}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "player" });
          }}
        />
        <AwardRow
          label="Defender of the Day"
          valueLabel={defenderOfDay ? nameFor(confirmed.find((p) => p.id === defenderOfDay) || { id: defenderOfDay, full_name: null }) : "None"}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "defender" });
          }}
        />
        <AwardRow
          label="Midfielder of the Day"
          valueLabel={midfielderOfDay ? nameFor(confirmed.find((p) => p.id === midfielderOfDay) || { id: midfielderOfDay, full_name: null }) : "None"}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "midfielder" });
          }}
        />
        <AwardRow
          label="Attacker of the Day"
          valueLabel={attackerOfDay ? nameFor(confirmed.find((p) => p.id === attackerOfDay) || { id: attackerOfDay, full_name: null }) : "None"}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "attacker" });
          }}
        />
      </View>

      <Pressable
        onPress={() => void onSubmit()}
        disabled={submitting}
        style={({ pressed }) => [styles.primaryBtn, (pressed && !submitting) && { opacity: 0.92 }, submitting && styles.disabled]}
      >
        <View style={styles.primaryBtnInner}>
          {submitting ? <ActivityIndicator color="#111" /> : <FontAwesome name="check" size={16} color="#111" />}
          <Text style={styles.primaryBtnText}>{submitting ? "Saving…" : "Submit result"}</Text>
        </View>
      </Pressable>

      <SelectModal<Team>
        visible={picker?.kind === "winning"}
        title="Winning team"
        options={winningOptions}
        value={winningTeam}
        onSelect={setWinningTeam}
        onClose={() => setPicker(null)}
      />

      <SelectModal<Team>
        visible={picker?.kind === "team"}
        title="Team assignment"
        options={teamOptions}
        value={picker?.kind === "team" ? (teamByUser[picker.userId] ?? "A") : null}
        onSelect={(t) => {
          if (picker?.kind !== "team") return;
          const uid = picker.userId;
          setTeamByUser((cur) => ({ ...cur, [uid]: t }));
        }}
        onClose={() => setPicker(null)}
      />

      <SelectModal<string>
        visible={picker?.kind === "award"}
        title={
          picker?.kind === "award" && picker.which === "player"
            ? "Player of the Day"
            : picker?.kind === "award" && picker.which === "defender"
              ? "Defender of the Day"
              : picker?.kind === "award" && picker.which === "midfielder"
                ? "Midfielder of the Day"
                : "Attacker of the Day"
        }
        options={awardOptions}
        value={
          picker?.kind === "award"
            ? picker.which === "player"
              ? playerOfDay ?? ""
              : picker.which === "defender"
                ? defenderOfDay ?? ""
                : picker.which === "midfielder"
                  ? midfielderOfDay ?? ""
                  : attackerOfDay ?? ""
            : null
        }
        onSelect={(v) => {
          const next = v ? v : null;
          if (picker?.kind !== "award") return;
          if (picker.which === "player") setPlayerOfDay(next);
          else if (picker.which === "defender") setDefenderOfDay(next);
          else if (picker.which === "midfielder") setMidfielderOfDay(next);
          else setAttackerOfDay(next);
        }}
        onClose={() => setPicker(null)}
      />
    </ScrollView>
  );
}

function AwardRow({ label, valueLabel, onPress }: { label: string; valueLabel: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.awardRow, pressed && { opacity: 0.9 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.awardLabel}>{label}</Text>
        <Text style={styles.awardValue} numberOfLines={1}>
          {valueLabel}
        </Text>
      </View>
      <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", padding: 24 },
  errText: { color: "#fca5a5", fontSize: 15, textAlign: "center" },

  headerCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
    marginBottom: 12,
  },
  h1: { fontSize: 22, fontWeight: "900", color: "#fff" },
  sub: { marginTop: 8, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.55)" },

  sectionTitle: { marginTop: 18, fontSize: 12, fontWeight: "900", letterSpacing: 1.1, color: "rgba(255,255,255,0.45)", textTransform: "uppercase" },

  segmentRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  segmentChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segmentChipActive: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.12)" },
  segmentText: { color: "rgba(255,255,255,0.55)", fontSize: 15, fontWeight: "800" },
  segmentTextActive: { color: LIME },

  generateBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.4)",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  generateBtnText: { color: "#a3e635", fontWeight: "700", fontSize: 14 },

  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  muted: { color: "rgba(255,255,255,0.55)", fontSize: 14 },

  rosterRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  personName: { color: "#fff", fontWeight: "800", fontSize: 15 },
  teamPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  teamPillText: { color: LIME, fontWeight: "900", fontSize: 13 },

  awardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  awardLabel: { color: "rgba(255,255,255,0.65)", fontWeight: "800", fontSize: 12 },
  awardValue: { marginTop: 6, color: "#fff", fontWeight: "800", fontSize: 15 },

  input: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  selectTrigger: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectValue: { color: "#fff", fontSize: 16, fontWeight: "800" },
  selectChevron: { color: LIME, fontSize: 14 },

  primaryBtn: {
    marginTop: 20,
    backgroundColor: LIME,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryBtnText: { color: "#111", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.6 },

  modalRoot: { flex: 1 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  modalCardWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "center", paddingHorizontal: 28 },
  modalCard: {
    backgroundColor: "#141414",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", color: LIME, paddingHorizontal: 16, paddingVertical: 12 },
  modalRow: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, marginHorizontal: 4 },
  modalRowSelected: { backgroundColor: "rgba(163,230,53,0.12)" },
  modalRowText: { fontSize: 16, color: "rgba(255,255,255,0.85)" },
  modalRowTextSelected: { color: LIME, fontWeight: "700" },
  modalCancel: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  modalCancelText: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
});

