import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminPickupInvitePlayersForm,
  postAdminPickupInvitePlayers,
  type InvitePlayersFormPlayer,
} from "@/lib/adminApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LIME = "#a3e635";
const PROXIMITY_AUTO_SELECT_MIN = 30;
const PROXIMITY_VISIBLE_MAX_MIN = 60;

type TierGroupId = "tier1" | "tier2" | "tier3" | "others";

const TIER_GROUPS: { id: TierGroupId; label: string }[] = [
  { id: "tier1", label: "Tier 1" },
  { id: "tier2", label: "Tier 2" },
  { id: "tier3", label: "Tier 3" },
  { id: "others", label: "Others" },
];

function tierGroupId(tierRank: number | null): TierGroupId {
  const r = tierRank ?? 6;
  if (r <= 2) return "tier1";
  if (r === 3) return "tier2";
  if (r === 4) return "tier3";
  return "others";
}

function tierBadgeLabel(tierRank: number | null): string | null {
  const g = tierGroupId(tierRank);
  if (g === "tier1") return "T1";
  if (g === "tier2") return "T2";
  if (g === "tier3") return "T3";
  return null;
}

function formatInstagram(handle: string | null): string | null {
  if (!handle) return null;
  const raw = handle.trim();
  if (!raw) return null;
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function playerMatchesQuery(p: InvitePlayersFormPlayer, q: string): boolean {
  const name = p.display_name.toLowerCase();
  const un = (p.username || "").toLowerCase();
  const ig = (p.instagram || "").toLowerCase();
  return name.includes(q) || un.includes(q) || ig.includes(q);
}

function isWithinMinutes(distance: number | null, max: number): boolean {
  return distance != null && distance <= max;
}

function isVisibleByProximity(p: InvitePlayersFormPlayer, showAll: boolean): boolean {
  if (showAll) return true;
  if (p.distance_minutes == null) return false;
  return p.distance_minutes <= PROXIMITY_VISIBLE_MAX_MIN;
}

function autoSelectIds(players: InvitePlayersFormPlayer[]): Set<string> {
  return new Set(
    players
      .filter((p) => isWithinMinutes(p.distance_minutes, PROXIMITY_AUTO_SELECT_MIN))
      .map((p) => p.id),
  );
}

export default function InvitePlayersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ run_id?: string }>();
  const runId = typeof params.run_id === "string" && params.run_id.trim() ? params.run_id.trim() : "";
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runTitle, setRunTitle] = useState<string>("");
  const [runVenue, setRunVenue] = useState<string | null>(null);
  const [players, setPlayers] = useState<InvitePlayersFormPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!token || !runId) {
      setLoading(false);
      setError(!runId ? "Missing run." : "Not signed in.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAdminPickupInvitePlayersForm(token, runId);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setPlayers([]);
      return;
    }
    const titleRaw = r.data.run?.title;
    setRunTitle(typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : "Pickup run");
    const venueRaw = r.data.run?.venue;
    setRunVenue(typeof venueRaw === "string" && venueRaw.trim() ? venueRaw.trim() : null);
    const list = Array.isArray(r.data.players) ? r.data.players : [];
    setPlayers(list);
    setSelected(autoSelectIds(list));
  }, [token, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    let within30 = 0;
    let within60 = 0;
    for (const p of players) {
      if (isWithinMinutes(p.distance_minutes, PROXIMITY_AUTO_SELECT_MIN)) within30 += 1;
      if (isWithinMinutes(p.distance_minutes, PROXIMITY_VISIBLE_MAX_MIN)) within60 += 1;
    }
    return { within30, within60 };
  }, [players]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (q && !playerMatchesQuery(p, q)) return false;
      if (q) return true;
      return isVisibleByProximity(p, showAllPlayers);
    });
  }, [players, query, showAllPlayers]);

  const grouped = useMemo(() => {
    const buckets = new Map<TierGroupId, InvitePlayersFormPlayer[]>();
    for (const g of TIER_GROUPS) buckets.set(g.id, []);
    for (const p of filtered) {
      buckets.get(tierGroupId(p.tier_rank))!.push(p);
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => {
        const da = a.distance_minutes ?? Number.POSITIVE_INFINITY;
        const db = b.distance_minutes ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
    return TIER_GROUPS.map((g) => ({ ...g, players: buckets.get(g.id)! })).filter((g) => g.players.length > 0);
  }, [filtered]);

  const farHiddenCount = useMemo(() => {
    if (query.trim()) return 0;
    return players.filter((p) => p.distance_minutes != null && p.distance_minutes > PROXIMITY_VISIBLE_MAX_MIN).length;
  }, [players, query]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setGroupSelection = useCallback((groupPlayers: InvitePlayersFormPlayer[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of groupPlayers) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }, []);

  const nSel = selected.size;

  async function onInvite() {
    if (!token || !runId || nSel === 0 || busy) return;
    setBusy(true);
    setError(null);
    const r = await postAdminPickupInvitePlayers(token, {
      run_id: runId,
      user_ids: Array.from(selected),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const invited = Number(r.data.invited ?? 0);
    setSelected(new Set());
    void load();
    Alert.alert(
      invited ? "Invites sent" : "Already invited",
      invited ? `Sent ${invited} invite${invited === 1 ? "" : "s"}.` : "Those players already had an invite for this run.",
    );
  }

  if (!runId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <Text style={styles.err}>Missing run_id.</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backIcon, pressed && { opacity: 0.8 }]}>
          <FontAwesome name="chevron-left" size={18} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.h1} numberOfLines={2}>
            Invite players
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {runTitle}
            {runVenue ? ` · ${runVenue}` : ""}
          </Text>
        </View>
      </View>

      {!loading && !error ? (
        <Text style={styles.summary}>
          {nSel} player{nSel === 1 ? "" : "s"} selected · {summary.within30} within 30 min · {summary.within60} within 60 min
        </Text>
      ) : null}

      <Text style={styles.help}>
        Players within 30 min are pre-selected. Between 30–60 min are listed but not selected. Farther players are hidden unless you show all.
      </Text>

      <TextInput
        style={styles.search}
        placeholder="Search by name or username"
        placeholderTextColor="rgba(255,255,255,0.35)"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {!loading && !error && farHiddenCount > 0 && !query.trim() ? (
        <Pressable
          onPress={() => setShowAllPlayers((v) => !v)}
          style={({ pressed }) => [styles.showAllBtn, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.showAllBtnText}>
            {showAllPlayers ? "Hide distant players" : `Show all players (${farHiddenCount} over 60 min)`}
          </Text>
        </Pressable>
      ) : null}

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.err}>{error}</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 120 }}>
          {grouped.length === 0 ? (
            <Text style={styles.empty}>No players match your search.</Text>
          ) : (
            grouped.map((group) => {
              const allOn = group.players.every((p) => selected.has(p.id));
              return (
                <View key={group.id} style={styles.tierSection}>
                  <View style={styles.tierHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.tierTitle}>{group.label}</Text>
                      <Text style={styles.tierCount}>
                        {group.players.length} player{group.players.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setGroupSelection(group.players, !allOn)}
                      style={({ pressed }) => [styles.groupActionBtn, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={styles.groupActionBtnText}>{allOn ? "Deselect all" : "Select all"}</Text>
                    </Pressable>
                  </View>
                  {group.players.map((p) => {
                    const on = selected.has(p.id);
                    const tierLbl = tierBadgeLabel(p.tier_rank);
                    const ig = formatInstagram(p.instagram);
                    const dist =
                      p.distance_minutes != null ? `${p.distance_minutes} min` : null;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => toggle(p.id)}
                        style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
                      >
                        <View style={[styles.checkbox, on && styles.checkboxOn]}>
                          {on ? <FontAwesome name="check" size={14} color="#111" /> : null}
                        </View>
                        <View style={styles.rowBody}>
                          <View style={styles.rowTop}>
                            <Text style={styles.name} numberOfLines={1}>
                              {p.display_name}
                            </Text>
                            <View style={styles.rowBadges}>
                              {tierLbl ? (
                                <View style={styles.tierBadge}>
                                  <Text style={styles.tierBadgeText}>{tierLbl}</Text>
                                </View>
                              ) : null}
                              {dist ? (
                                <View style={styles.distanceBadge}>
                                  <Text style={styles.distanceBadgeText}>{dist}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          {p.username ? (
                            <Text style={styles.username} numberOfLines={1}>
                              @{p.username}
                            </Text>
                          ) : null}
                          {ig ? (
                            <Text style={styles.instagram} numberOfLines={1}>
                              {ig}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={() => void onInvite()}
          disabled={busy || nSel === 0 || loading}
          style={({ pressed }) => [
            styles.inviteBtn,
            (busy || nSel === 0 || loading) && styles.inviteBtnDisabled,
            pressed && nSel > 0 && !busy && !loading && { opacity: 0.92 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <Text style={styles.inviteBtnText}>
              Invite {nSel} player{nSel === 1 ? "" : "s"}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8 },
  backIcon: { paddingVertical: 8, paddingRight: 4 },
  h1: { fontSize: 22, fontWeight: "800", color: "#fff" },
  sub: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.55)" },
  summary: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "700",
    color: LIME,
  },
  help: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: "rgba(255,255,255,0.55)",
  },
  search: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
  },
  showAllBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  showAllBtnText: { fontSize: 14, fontWeight: "700", color: LIME },
  list: { flex: 1, marginTop: 8 },
  tierSection: { marginTop: 16 },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  tierTitle: { fontSize: 15, fontWeight: "800", color: "#fff" },
  tierCount: { marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.45)" },
  groupActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  groupActionBtnText: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.75)" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginTop: 2,
  },
  checkboxOn: {
    borderColor: LIME,
    backgroundColor: LIME,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "700", color: "#fff" },
  rowBadges: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  tierBadgeText: { fontSize: 11, fontWeight: "800", color: LIME },
  distanceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  distanceBadgeText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.45)" },
  username: { marginTop: 2, fontSize: 13, color: "rgba(255,255,255,0.45)" },
  instagram: { marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.35)" },
  empty: { marginTop: 24, color: "rgba(255,255,255,0.45)", fontSize: 15 },
  err: { marginTop: 16, color: "#fca5a5", fontSize: 15 },
  footer: {
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0a0a0a",
  },
  inviteBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LIME,
    paddingVertical: 16,
    borderRadius: 14,
    minHeight: 52,
  },
  inviteBtnDisabled: { opacity: 0.45 },
  inviteBtnText: { color: "#111", fontWeight: "800", fontSize: 16 },
  backBtn: { marginTop: 16, alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 14 },
  backBtnText: { color: LIME, fontWeight: "700", fontSize: 15 },
});
