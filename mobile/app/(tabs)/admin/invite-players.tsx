import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminPickupInvitePlayersForm,
  postAdminPickupInvitePlayers,
  type InvitePlayersFormPlayer,
} from "@/lib/adminApi";
import { goToAdminMenu } from "@/lib/adminNavigation";
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

import { themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

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
        <Pressable onPress={() => goToAdminMenu(router)} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => goToAdminMenu(router)} style={({ pressed }) => [styles.backIcon, pressed && { opacity: 0.8 }]}>
          <FontAwesome name="chevron-left" size={18} color={themeColor().text} />
          <Text style={styles.backBtnText}>Back</Text>
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
        placeholderTextColor={themeColor().muted}
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
        <ActivityIndicator color={themeColor().text} style={{ marginTop: 24 }} />
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
                          {on ? <FontAwesome name="check" size={14} color={themeColor().onPitch} /> : null}
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
            <ActivityIndicator color={themeColor().onPitch} />
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

function make_styles() {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: themeColor().bg, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8 },
  backIcon: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingRight: 4 },
  h1: { fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800", color: themeColor().text },
  sub: { marginTop: 4, fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().muted },
  summary: {
    marginTop: 12,
    fontSize: 14, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().pitchText,
  },
  help: {
    marginTop: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 18,
    color: themeColor().muted,
  },
  search: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_400Regular",
  },
  showAllBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  showAllBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().pitchText },
  list: { flex: 1, marginTop: 8 },
  tierSection: { marginTop: 16 },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColor().line,
  },
  tierTitle: { fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  tierCount: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  groupActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  groupActionBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColor().line,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginTop: 4,
  },
  checkboxOn: {
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitch,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().text },
  rowBadges: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  tierBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().onPitchPanel },
  distanceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: themeColor().overlaySubtle,
  },
  distanceBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted },
  username: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  instagram: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  empty: { marginTop: 24, color: themeColor().muted, fontSize: 16, fontFamily: "Inter_400Regular" },
  err: { marginTop: 16, color: themeColor().coralText, fontSize: 16, fontFamily: "Inter_400Regular" },
  footer: {
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColor().line,
    backgroundColor: themeColor().bg,
  },
  inviteBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: themeColor().pitch,
    paddingVertical: 16,
    borderRadius: 12,
    minHeight: 52,
  },
  inviteBtnDisabled: { opacity: 0.45 },
  inviteBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  backBtn: { marginTop: 16, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12 },
  backBtnText: { color: themeColor().pitchText, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

