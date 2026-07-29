import { useAuth } from "@/context/AuthContext";
import * as Sentry from "@sentry/react-native";
import { hapticError, hapticGoal, hapticTap, hapticWhistle } from "@/lib/haptics";
import {
  fetchAdminPickupSwitchDetail,
  fetchAdminPickupResult,
  postAdminMarkAttendance,
  postAdminPickupResult,
} from "@/lib/adminApi";
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

function isTeam(v: unknown): v is Team {
  return v === "A" || v === "B" || v === "C";
}

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
  allowClear = false,
}: {
  visible: boolean;
  title: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onSelect: (v: T | null) => void;
  onClose: () => void;
  /** When true, tapping the selected option clears the value (award deselection). */
  allowClear?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close picker" />
        <View style={styles.modalCardWrap} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            {allowClear && value ? (
              <Pressable
                onPress={() => {
                  void hapticTap();
                  onSelect(null);
                  onClose();
                }}
                style={({ pressed }) => [styles.modalClearRow, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="Remove selection"
              >
                <Text style={styles.modalClearText}>✕ Remove selection</Text>
              </Pressable>
            ) : null}
            {options.map((opt) => {
              const selected = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    void hapticTap();
                    if (allowClear && selected) {
                      onSelect(null);
                    } else {
                      onSelect(opt.value);
                    }
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    selected && styles.modalRowSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.modalRowText, selected && styles.modalRowTextSelected]} numberOfLines={1}>
                    {opt.label}
                  </Text>
                  {selected ? (
                    <Text style={styles.modalRowRemove}>{allowClear ? "✕" : "✓"}</Text>
                  ) : null}
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
  const { run_id: rawRunId, readonly: rawReadonly } = useLocalSearchParams<{
    run_id?: string | string[];
    readonly?: string | string[];
  }>();
  const runId = typeof rawRunId === "string" ? rawRunId : Array.isArray(rawRunId) ? rawRunId[0] : "";
  const readonlyParam =
    typeof rawReadonly === "string" ? rawReadonly : Array.isArray(rawReadonly) ? rawReadonly[0] : "";
  const isReadonly = readonlyParam === "1" || readonlyParam === "true";

  const { session, supabase } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [region, setRegion] = useState<ServiceRegionCode | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedRow[]>([]);

  const [totalTeams, setTotalTeams] = useState<2 | 3>(2);
  const [winningTeam, setWinningTeam] = useState<Team>("A");
  const [teamByUser, setTeamByUser] = useState<Record<string, Team>>({});

  const [playerOfDay, setPlayerOfDay] = useState<string | null>(null);
  const [goalieOfTheDay, setGoalieOfTheDay] = useState<string | null>(null);
  const [defenderOfDay, setDefenderOfDay] = useState<string | null>(null);
  const [midfielderOfDay, setMidfielderOfDay] = useState<string | null>(null);
  const [attackerOfDay, setAttackerOfDay] = useState<string | null>(null);

  const [picker, setPicker] = useState<
    | null
    | { kind: "team"; userId: string }
    | { kind: "winning" }
    | { kind: "award"; which: "player" | "goalie" | "defender" | "midfielder" | "attacker" }
  >(null);

  const [teamsReadOnly, setTeamsReadOnly] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  /** `true` = attended, `false` = no-show. Missing key treated as attended until DB load replaces map. */
  const [attendanceByUser, setAttendanceByUser] = useState<Record<string, boolean>>({});
  const [attendanceSaving, setAttendanceSaving] = useState<Record<string, boolean>>({});

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isReadonly ? "View Results" : "Post Results",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation, isReadonly]);

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
      setTeamsReadOnly(false);
      try {
        const r = await fetchAdminPickupSwitchDetail(token, runId);
        if (cancelled) return;
        if (!r.ok) {
          setErr(r.error || "Couldn’t load run.");
          setConfirmed([]);
          setRegion(null);
          setTeamByUser({});
          setAttendanceByUser({});
          return;
        }
        const run = r.data.run;
        const regionRaw = run && typeof run === "object" ? (run as Record<string, unknown>).service_region : null;
        const reg = typeof regionRaw === "string" ? (regionRaw.trim().toUpperCase() as ServiceRegionCode) : null;
        setRegion(reg && ["CT", "NY", "NJ", "MD"].includes(reg) ? reg : null);
        const list = Array.isArray(r.data.confirmed) ? (r.data.confirmed as ConfirmedRow[]) : [];
        setConfirmed(list);

        const attendanceMap: Record<string, boolean> = {};
        for (const p of list) attendanceMap[p.id] = true;
        if (supabase) {
          const { data: attRows, error: attErr } = await supabase
            .from("pickup_run_attendance")
            .select("user_id,attended")
            .eq("run_id", runId);
          if (!attErr && attRows) {
            for (const row of attRows as { user_id?: unknown; attended?: unknown }[]) {
              const uid = typeof row.user_id === "string" ? row.user_id : null;
              if (!uid || !(uid in attendanceMap)) continue;
              attendanceMap[uid] = row.attended === true;
            }
          }
        }
        if (!cancelled) setAttendanceByUser(attendanceMap);

        if (isReadonly) {
          const res = await fetchAdminPickupResult(token, runId);
          if (cancelled) return;
          if (!res.ok) {
            setErr(res.error || "Couldn’t load results.");
            return;
          }
          const resultRow = res.data.result;
          if (!resultRow || typeof resultRow !== "object") {
            setErr("No results posted for this run yet.");
            return;
          }
          const row = resultRow as Record<string, unknown>;
          setTotalTeams(Number(row.total_teams) === 3 ? 3 : 2);
          if (isTeam(row.winning_team)) setWinningTeam(row.winning_team);
          setPlayerOfDay(typeof row.player_of_day === "string" ? row.player_of_day : null);
          setGoalieOfTheDay(typeof row.goalie_of_the_day === "string" ? row.goalie_of_the_day : null);
          setDefenderOfDay(typeof row.defender_of_day === "string" ? row.defender_of_day : null);
          setMidfielderOfDay(typeof row.midfielder_of_day === "string" ? row.midfielder_of_day : null);
          setAttackerOfDay(typeof row.attacker_of_day === "string" ? row.attacker_of_day : null);
          const fromApi: Record<string, Team> = {};
          for (const a of res.data.team_assignments ?? []) {
            const o = a as { user_id?: unknown; team?: unknown };
            const uid = typeof o.user_id === "string" ? o.user_id : "";
            if (uid && isTeam(o.team)) fromApi[uid] = o.team;
          }
          setTeamByUser(fromApi);
          setTeamsReadOnly(true);
          return;
        }

        const fromDb: Record<string, Team> = {};
        if (supabase) {
          const { data: assignRows, error: assignErr } = await supabase
            .from("pickup_run_team_assignments")
            .select("user_id,team")
            .eq("run_id", runId);
          if (cancelled) return;
          if (assignErr) {
            console.warn("[run-result] team assignments load:", assignErr.message);
          }
          for (const row of assignRows ?? []) {
            const o = row as { user_id?: unknown; team?: unknown };
            const uid = typeof o.user_id === "string" ? o.user_id : "";
            const tm = o.team;
            if (uid && isTeam(tm)) fromDb[uid] = tm;
          }
        }
        if (cancelled) return;
        const hasSaved = Object.keys(fromDb).length > 0;
        if (hasSaved) {
          setTeamByUser(fromDb);
          setTeamsReadOnly(true);
          setTotalTeams(Object.values(fromDb).some((t) => t === "C") ? 3 : 2);
        } else {
          setTeamsReadOnly(false);
          setTotalTeams(2);
          const next: Record<string, Team> = {};
          list.forEach((p, idx) => {
            next[p.id] = idx % 2 === 0 ? "A" : "B";
          });
          setTeamByUser(next);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[run-result] load failed", e);
          Sentry.captureException(e);
          setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
          setConfirmed([]);
          setRegion(null);
          setTeamByUser({});
          setAttendanceByUser({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, runId, supabase, isReadonly]);

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
    const opts = confirmed
      .filter((p) => attendanceByUser[p.id] !== false)
      .map((p) => ({ value: p.id, label: nameFor(p) }));
    return [{ value: "" as const, label: "None" }, ...opts] as const;
  }, [confirmed, attendanceByUser]);

  const attendedIds = useMemo(
    () => new Set(confirmed.filter((p) => attendanceByUser[p.id] !== false).map((p) => p.id)),
    [confirmed, attendanceByUser],
  );

  const attendedConfirmedCount = useMemo(
    () => confirmed.filter((p) => attendanceByUser[p.id] !== false).length,
    [confirmed, attendanceByUser],
  );

  const teamOptions = useMemo(
    () => allowedTeams.map((t) => ({ value: t, label: labelTeam(t) })),
    [allowedTeams],
  );

  const winningOptions = teamOptions;

  const filledAssignments = useMemo(() => {
    return confirmed
      .filter((p) => attendanceByUser[p.id] !== false)
      .map((p) => ({
        user_id: p.id,
        team: teamByUser[p.id] ?? "A",
      }))
      .filter((a) => allowedTeams.includes(a.team));
  }, [confirmed, teamByUser, allowedTeams, attendanceByUser]);

  const awardWinners = uniq([playerOfDay, goalieOfTheDay, defenderOfDay, midfielderOfDay, attackerOfDay].filter(Boolean));
  const awardWinnerNotInConfirmed = awardWinners.some(
    (id) => !id || !confirmed.some((p) => p.id === id) || !attendedIds.has(id),
  );

  async function onMarkAttendance(userId: string, attended: boolean) {
    if (!token || !runId || isReadonly) return;
    const prevAttended = attendanceByUser[userId] !== false;
    if (prevAttended === attended) return;

    const player = confirmed.find((p) => p.id === userId);
    const displayName = nameFor(player || { id: userId, full_name: null });

    if (!attended) {
      let cleared = false;
      if (playerOfDay === userId) cleared = true;
      if (goalieOfTheDay === userId) cleared = true;
      if (defenderOfDay === userId) cleared = true;
      if (midfielderOfDay === userId) cleared = true;
      if (attackerOfDay === userId) cleared = true;
      if (cleared) {
        setPlayerOfDay((v) => (v === userId ? null : v));
        setGoalieOfTheDay((v) => (v === userId ? null : v));
        setDefenderOfDay((v) => (v === userId ? null : v));
        setMidfielderOfDay((v) => (v === userId ? null : v));
        setAttackerOfDay((v) => (v === userId ? null : v));
        Alert.alert("", `Award cleared — ${displayName} was marked as a no-show`);
      }
    }

    setAttendanceByUser((cur) => ({ ...cur, [userId]: attended }));
    setAttendanceSaving((s) => ({ ...s, [userId]: true }));

    const r = await postAdminMarkAttendance(token, {
      run_id: runId,
      attendance: [{ user_id: userId, attended }],
    });

    setAttendanceSaving((s) => {
      const next = { ...s };
      delete next[userId];
      return next;
    });

    if (!r.ok) {
      void hapticError();
      setAttendanceByUser((cur) => ({ ...cur, [userId]: prevAttended }));
      Alert.alert("Couldn’t save attendance", r.error || "Request failed.");
      return;
    }
    void hapticTap();
  }

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
    if (attendedConfirmedCount === 0) {
      void hapticError();
      return Alert.alert("Attendance required", "Mark at least one player as attended to post results.");
    }
    if (filledAssignments.length !== attendedConfirmedCount) {
      void hapticError();
      return Alert.alert("Missing teams", "Assign a team for each player who attended.");
    }
    if (awardWinnerNotInConfirmed) {
      void hapticError();
      return Alert.alert("Awards must be from roster", "Award winners must be selected from players marked as attended.");
    }

    void hapticGoal();
    setSubmitting(true);
    const r = await postAdminPickupResult(token, {
      run_id: runId,
      total_teams: totalTeams,
      winning_team: winningTeam,
      team_assignments: filledAssignments,
      player_of_day: playerOfDay,
      goalie_of_the_day: goalieOfTheDay,
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
    Alert.alert("Posted", "Results posted and notifications sent.", [
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
        <Text style={styles.h1}>{isReadonly ? "Results" : "Post Results"}</Text>
        <Text style={styles.sub}>
          {region ? `Region: ${serviceRegionName(region)}` : "Region: —"}{"\n"}
          Confirmed players: {confirmed.length}
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Step 1: Mark Attendance</Text>
      <View style={styles.card}>
        {confirmed.length === 0 ? <Text style={styles.muted}>No confirmed players.</Text> : null}
        {confirmed.map((p) => {
          const attended = attendanceByUser[p.id] !== false;
          const saving = !!attendanceSaving[p.id];
          return (
            <View key={`att-${p.id}`} style={styles.attendanceRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.personName} numberOfLines={1}>
                  {nameFor(p)}
                </Text>
              </View>
              <View style={styles.attendanceChipRow}>
                <Pressable
                  disabled={isReadonly || saving}
                  onPress={() => void onMarkAttendance(p.id, true)}
                  style={({ pressed }) => [
                    styles.attendanceChip,
                    attended && styles.attendanceChipActive,
                    (isReadonly || saving) && styles.attendanceChipDisabled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.attendanceChipText, attended && styles.attendanceChipTextActive]}>Attended ✓</Text>
                </Pressable>
                <Pressable
                  disabled={isReadonly || saving}
                  onPress={() => void onMarkAttendance(p.id, false)}
                  style={({ pressed }) => [
                    styles.attendanceChip,
                    !attended && styles.attendanceChipActiveNoShow,
                    (isReadonly || saving) && styles.attendanceChipDisabled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.attendanceChipText, !attended && styles.attendanceChipTextNoShowActive]}>
                    No-show ✗
                  </Text>
                </Pressable>
                {saving ? <ActivityIndicator size="small" color={LIME} style={{ marginLeft: 8 }} /> : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Step 2: Teams (read-only when saved at run start; manual fallback if none) */}
      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Step 2: Teams</Text>
      {!teamsReadOnly && confirmed.length > 0 ? (
        <Text style={styles.teamFallbackWarn}>
          Teams were not assigned before this run. Please assign teams manually.
        </Text>
      ) : null}
      {teamsReadOnly ? (
        <Text style={styles.teamReadOnlyMeta}>
          {totalTeams} teams (locked before this run)
        </Text>
      ) : (
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
      )}

      <View style={styles.card}>
        {confirmed.length === 0 ? <Text style={styles.muted}>No confirmed players.</Text> : null}
        {confirmed.map((p) => {
          const team = teamByUser[p.id] ?? "A";
          const isNoShow = attendanceByUser[p.id] === false;
          return (
            <View key={p.id} style={[styles.rosterRow, isNoShow && styles.rosterRowNoShow]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.personName, isNoShow && styles.personNameMuted]} numberOfLines={1}>
                  {nameFor(p)}
                </Text>
                {isNoShow ? <Text style={styles.noShowLabel}>No-show</Text> : null}
              </View>
              {isNoShow ? (
                <View style={[styles.teamPillReadonly, styles.teamPillNoShow]}>
                  <Text style={styles.teamPillReadonlyText}>
                    {teamsReadOnly ? `${labelTeam(team)} · No-show` : "No-show"}
                  </Text>
                </View>
              ) : teamsReadOnly ? (
                <View style={styles.teamPillReadonly}>
                  <Text style={styles.teamPillReadonlyText}>{labelTeam(team)}</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    void hapticTap();
                    setPicker({ kind: "team", userId: p.id });
                  }}
                  style={({ pressed }) => [styles.teamPill, pressed && { opacity: 0.9 }]}
                >
                  <Text style={styles.teamPillText}>{labelTeam(team)}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {/* 2) Winning team */}
      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Winning team</Text>
      <Pressable
        onPress={() => {
          if (isReadonly) return;
          void hapticTap();
          setPicker({ kind: "winning" });
        }}
        disabled={isReadonly}
        style={({ pressed }) => [styles.input, styles.selectTrigger, pressed && { opacity: 0.9 }, isReadonly && { opacity: 0.5 }]}
      >
        <Text style={styles.selectValue}>{labelTeam(winningTeam)}</Text>
        <Text style={styles.selectChevron}>▾</Text>
      </Pressable>

      {/* 3) Awards */}
      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Step 3: Awards</Text>
      <View style={styles.card}>
        <AwardRow
          label="Player of the Day 🏆"
          valueLabel={playerOfDay ? nameFor(confirmed.find((p) => p.id === playerOfDay) || { id: playerOfDay, full_name: null }) : "None"}
          hasValue={Boolean(playerOfDay)}
          disabled={isReadonly}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "player" });
          }}
          onClear={() => {
            void hapticTap();
            setPlayerOfDay(null);
          }}
        />
        <AwardRow
          label="Goalie of the Day 🧤"
          valueLabel={goalieOfTheDay ? nameFor(confirmed.find((p) => p.id === goalieOfTheDay) || { id: goalieOfTheDay, full_name: null }) : "None"}
          hasValue={Boolean(goalieOfTheDay)}
          disabled={isReadonly}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "goalie" });
          }}
          onClear={() => {
            void hapticTap();
            setGoalieOfTheDay(null);
          }}
        />
        <AwardRow
          label="Attacker of the Day ⚡"
          valueLabel={attackerOfDay ? nameFor(confirmed.find((p) => p.id === attackerOfDay) || { id: attackerOfDay, full_name: null }) : "None"}
          hasValue={Boolean(attackerOfDay)}
          disabled={isReadonly}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "attacker" });
          }}
          onClear={() => {
            void hapticTap();
            setAttackerOfDay(null);
          }}
        />
        <AwardRow
          label="Midfielder of the Day 🎯"
          valueLabel={midfielderOfDay ? nameFor(confirmed.find((p) => p.id === midfielderOfDay) || { id: midfielderOfDay, full_name: null }) : "None"}
          hasValue={Boolean(midfielderOfDay)}
          disabled={isReadonly}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "midfielder" });
          }}
          onClear={() => {
            void hapticTap();
            setMidfielderOfDay(null);
          }}
        />
        <AwardRow
          label="Defender of the Day 🛡️"
          valueLabel={defenderOfDay ? nameFor(confirmed.find((p) => p.id === defenderOfDay) || { id: defenderOfDay, full_name: null }) : "None"}
          hasValue={Boolean(defenderOfDay)}
          disabled={isReadonly}
          onPress={() => {
            void hapticTap();
            setPicker({ kind: "award", which: "defender" });
          }}
          onClear={() => {
            void hapticTap();
            setDefenderOfDay(null);
          }}
        />
      </View>

      {/* 4) Submit "Post Results" */}
      {!isReadonly ? (
        <Pressable
          onPress={() => void onSubmit()}
          disabled={submitting}
          style={({ pressed }) => [styles.primaryBtn, (pressed && !submitting) && { opacity: 0.92 }, submitting && styles.disabled]}
        >
          <View style={styles.primaryBtnInner}>
            {submitting ? <ActivityIndicator color="#111" /> : <FontAwesome name="check" size={16} color="#111" />}
            <Text style={styles.primaryBtnText}>{submitting ? "Posting…" : "Post Results"}</Text>
          </View>
        </Pressable>
      ) : null}

      <SelectModal<Team>
        visible={picker?.kind === "winning"}
        title="Winning team"
        options={winningOptions}
        value={winningTeam}
        onSelect={setWinningTeam}
        onClose={() => setPicker(null)}
      />

      <SelectModal<Team>
        visible={!teamsReadOnly && picker?.kind === "team" && attendanceByUser[picker.userId] !== false}
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
            ? "Player of the Day 🏆"
            : picker?.kind === "award" && picker.which === "goalie"
              ? "Goalie of the Day 🧤"
            : picker?.kind === "award" && picker.which === "attacker"
              ? "Attacker of the Day ⚡"
              : picker?.kind === "award" && picker.which === "midfielder"
                ? "Midfielder of the Day 🎯"
                : "Defender of the Day 🛡️"
        }
        options={awardOptions}
        allowClear
        value={
          picker?.kind === "award"
            ? picker.which === "player"
              ? playerOfDay
              : picker.which === "goalie"
                ? goalieOfTheDay
              : picker.which === "defender"
                ? defenderOfDay
                : picker.which === "midfielder"
                  ? midfielderOfDay
                  : attackerOfDay
            : null
        }
        onSelect={(v) => {
          const next = v ? v : null;
          if (picker?.kind !== "award") return;
          if (picker.which === "player") setPlayerOfDay(next);
          else if (picker.which === "goalie") setGoalieOfTheDay(next);
          else if (picker.which === "defender") setDefenderOfDay(next);
          else if (picker.which === "midfielder") setMidfielderOfDay(next);
          else setAttackerOfDay(next);
        }}
        onClose={() => setPicker(null)}
      />
    </ScrollView>
  );
}

function AwardRow({
  label,
  valueLabel,
  hasValue,
  onPress,
  onClear,
  disabled,
}: {
  label: string;
  valueLabel: string;
  hasValue?: boolean;
  onPress: () => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.awardRow, disabled && { opacity: 0.5 }]}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }, pressed && !disabled && { opacity: 0.9 }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.awardLabel}>{label}</Text>
          <Text style={[styles.awardValue, hasValue && styles.awardValueSelected]} numberOfLines={1}>
            {valueLabel}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
      </Pressable>
      {hasValue && !disabled && onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          style={({ pressed }) => [styles.awardClearBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.awardClearText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
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

  attendanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  attendanceChipRow: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 },
  attendanceChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  attendanceChipActive: { borderColor: "rgba(163,230,53,0.55)", backgroundColor: "rgba(163,230,53,0.14)" },
  attendanceChipActiveNoShow: { borderColor: "rgba(248,113,113,0.45)", backgroundColor: "rgba(248,113,113,0.12)" },
  attendanceChipDisabled: { opacity: 0.45 },
  attendanceChipText: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.55)" },
  attendanceChipTextActive: { color: LIME },
  attendanceChipTextNoShowActive: { color: "#fca5a5" },

  rosterRowNoShow: { opacity: 0.72 },
  personNameMuted: { color: "rgba(255,255,255,0.45)" },
  noShowLabel: { marginTop: 4, fontSize: 11, fontWeight: "800", color: "rgba(248,113,113,0.9)", letterSpacing: 0.3 },
  teamPillNoShow: { borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)" },

  teamFallbackWarn: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(251,191,36,0.95)",
    lineHeight: 20,
  },
  teamReadOnlyMeta: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
  },

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
  teamPillReadonly: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  teamPillReadonlyText: { color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 13 },
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
  awardValueSelected: { color: LIME },
  awardClearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  awardClearText: { color: "rgba(255,255,255,0.75)", fontSize: 16, fontWeight: "700" },

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
  modalClearRow: {
    marginHorizontal: 8,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  modalClearText: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 14 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalRowSelected: { backgroundColor: "rgba(163,230,53,0.12)" },
  modalRowText: { flex: 1, fontSize: 16, color: "rgba(255,255,255,0.85)" },
  modalRowTextSelected: { color: LIME, fontWeight: "700" },
  modalRowRemove: { color: LIME, fontSize: 16, fontWeight: "800" },
  modalCancel: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  modalCancelText: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
});

