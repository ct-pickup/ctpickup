import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const POSITION_OPTIONS = ["Goalkeeper", "Defender", "Midfielder", "Attacker"] as const;
type PositionValue = (typeof POSITION_OPTIONS)[number];

const REGION_OPTIONS = ["CT", "NY", "NJ", "MD"] as const;
type RegionValue = (typeof REGION_OPTIONS)[number];

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  playing_position: string | null;
  zip_code: string | null;
  region: RegionValue | null;
  attended_count: number | null;
};

type PlayerCard = {
  id: string;
  name: string;
  username: string | null;
  position: PositionValue | null;
  region: RegionValue | null;
  gamesPlayed: number;
  winRatePct: number | null;
  awards: { potd: number; gk: number; def: number; mid: number; att: number };
};

function displayName(p: ProfileRow): string {
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const u = (p.username ?? "").trim();
  return u ? `@${u}` : "Player";
}

function parsePosition(v: string | null): PositionValue | null {
  const s = (v ?? "").trim();
  return (POSITION_OPTIONS as readonly string[]).includes(s) ? (s as PositionValue) : null;
}

function toggleInSet<T extends string>(cur: readonly T[], v: T): T[] {
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

export default function PlayersScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const navigation = useNavigation();
  const { supabase, isReady, session } = useAuth();

  const [q, setQ] = useState("");
  const [posFilter, setPosFilter] = useState<PositionValue[]>([]);
  const [regionFilter, setRegionFilter] = useState<RegionValue[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [winRateByUser, setWinRateByUser] = useState<Record<string, number | null>>({});
  const [awardsByUser, setAwardsByUser] = useState<Record<string, { potd: number; gk: number; def: number; mid: number; att: number }>>({});

  const profilesLoadSeq = useRef(0);
  const statsLoadSeq = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Players",
      headerStyle: { backgroundColor: themeColor().bg },
      headerTintColor: themeColor().text,
      headerShadowVisible: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (!isReady) return;
    const seq = ++profilesLoadSeq.current;
    setLoading(true);
    setErr(null);

    void (async () => {
      try {
        const origin = siteOrigin();
        const token = session?.access_token ?? null;

        if (!origin) {
          setRows([]);
          setErr("Set EXPO_PUBLIC_SITE_URL in mobile/.env to your deployed API host.");
          setLoading(false);
          return;
        }
        if (!token) {
          setRows([]);
          setErr("Sign in to view players.");
          setLoading(false);
          return;
        }

        const url = new URL(`${origin}/api/players`);
        const trimmed = q.trim();
        if (trimmed) url.searchParams.set("q", trimmed);

        // API accepts a single region; if multiple are selected we fetch unfiltered and filter locally.
        if (regionFilter.length === 1) url.searchParams.set("region", regionFilter[0]!);

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        const j = (await res.json()) as { error?: string; players?: ProfileRow[] };

        if (profilesLoadSeq.current !== seq) return;

        if (!res.ok) {
          setRows([]);
          setErr(j.error || "Something went wrong. Please try again.");
          setLoading(false);
          return;
        }

        let nextRows = (j.players ?? []) as ProfileRow[];

        // If multiple regions are selected, apply filter locally:
        // keep players in any selected region, plus players with null region (no zip).
        if (regionFilter.length > 1) {
          const allowed = new Set(regionFilter);
          nextRows = nextRows.filter((r) => r.region == null || allowed.has(r.region));
        }

        if (posFilter.length > 0) {
          const allowed = new Set(posFilter);
          nextRows = nextRows.filter((r) => (r.playing_position ? allowed.has(r.playing_position as PositionValue) : false));
        }

        setRows(nextRows);
        setLoading(false);
      } catch (e) {
        if (profilesLoadSeq.current !== seq) return;
        setRows([]);
        setErr(e instanceof Error ? e.message : "Request failed");
        setLoading(false);
      }
    })();
  }, [isReady, session?.access_token, q, posFilter, regionFilter]);

  useEffect(() => {
    if (!supabase) return;
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      setWinRateByUser({});
      setAwardsByUser({});
      return;
    }
    const seq = ++statsLoadSeq.current;
    void (async () => {
      const { data, error } = await supabase
        .from("pickup_run_team_assignments")
        .select("user_id,team,run_id,pickup_run_results(winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day)")
        .in("user_id", ids);
      if (statsLoadSeq.current !== seq) return;
      if (error || !data) {
        setWinRateByUser({});
        setAwardsByUser({});
        return;
      }
      const totals: Record<string, { played: number; wins: number }> = {};
      const awards: Record<string, { potd: number; gk: number; def: number; mid: number; att: number }> = {};
      for (const row of data as unknown as Array<{
        user_id: string;
        team: "A" | "B" | "C";
        pickup_run_results?: {
          winning_team: "A" | "B" | "C";
          player_of_day: string | null;
          goalie_of_the_day: string | null;
          defender_of_day: string | null;
          midfielder_of_day: string | null;
          attacker_of_day: string | null;
        } | null;
      }>) {
        const uid = row.user_id;
        const res = row.pickup_run_results;
        if (!uid || !res?.winning_team) continue;
        const t = (totals[uid] ??= { played: 0, wins: 0 });
        t.played += 1;
        if (row.team === res.winning_team) t.wins += 1;

        const a = (awards[uid] ??= { potd: 0, gk: 0, def: 0, mid: 0, att: 0 });
        if (res.player_of_day === uid) a.potd += 1;
        if (res.goalie_of_the_day === uid) a.gk += 1;
        if (res.defender_of_day === uid) a.def += 1;
        if (res.midfielder_of_day === uid) a.mid += 1;
        if (res.attacker_of_day === uid) a.att += 1;
      }
      const by: Record<string, number | null> = {};
      const byAwards: Record<string, { potd: number; gk: number; def: number; mid: number; att: number }> = {};
      for (const uid of ids) {
        const t = totals[uid];
        if (!t || t.played === 0) by[uid] = null;
        else by[uid] = Math.round((t.wins / t.played) * 100);
        byAwards[uid] = awards[uid] ?? { potd: 0, gk: 0, def: 0, mid: 0, att: 0 };
      }
      setWinRateByUser(by);
      setAwardsByUser(byAwards);
    })();
  }, [supabase, rows]);

  const players: PlayerCard[] = useMemo(() => {
    return rows.map((r) => {
      return {
        id: r.id,
        name: displayName(r),
        username: (r.username ?? "").trim() || null,
        position: parsePosition(r.playing_position),
        region: r.region ?? null,
        gamesPlayed: Math.max(0, Number(r.attended_count ?? 0) || 0),
        winRatePct: winRateByUser[r.id] ?? null,
        awards: awardsByUser[r.id] ?? { potd: 0, gk: 0, def: 0, mid: 0, att: 0 },
      };
    });
  }, [rows, winRateByUser, awardsByUser]);

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: 200 }]}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.searchRow}>
            <FontAwesome name="search" size={16} color={themeColor().muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search name or username"
              placeholderTextColor={themeColor().muted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>

          <Text style={styles.filterLabel}>Position</Text>
          <View style={styles.chipRow}>
            {POSITION_OPTIONS.map((p) => {
              const on = posFilter.includes(p);
              return (
                <Pressable
                  key={p}
                  onPress={() => setPosFilter((cur) => toggleInSet(cur, p))}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.filterLabel}>Region</Text>
          <View style={styles.chipRow}>
            {REGION_OPTIONS.map((r) => {
              const on = regionFilter.includes(r);
              return (
                <Pressable
                  key={r}
                  onPress={() => setRegionFilter((cur) => toggleInSet(cur, r))}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={themeColor().pitchText} />
              <Text style={styles.centerText}>Loading players…</Text>
            </View>
          ) : err ? (
            <Text style={styles.errText}>{err}</Text>
          ) : players.length === 0 ? (
            <Text style={styles.emptyText}>No players match your filters.</Text>
          ) : (
            <View style={styles.list}>
              {players.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/player/${p.id}`)}
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.username} numberOfLines={1}>
                        {p.username ? `@${p.username}` : "—"}
                      </Text>
                    </View>
                    <FontAwesome name="chevron-right" size={14} color={themeColor().muted} />
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Position</Text> {p.position ?? "—"}
                    </Text>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Region</Text>{" "}
                      {p.region != null ? (
                        <Text style={styles.metaValue}>{p.region}</Text>
                      ) : (
                        <Text style={styles.metaMuted}>No nearby hub</Text>
                      )}
                    </Text>
                  </View>

                  <View style={[styles.metaRow, { marginTop: 8 }]}>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Sessions</Text> {p.gamesPlayed}
                    </Text>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.meta}>
                      <Text style={styles.metaK}>Win rate</Text> {p.winRatePct == null ? "—" : `${p.winRatePct}%`}
                    </Text>
                  </View>

                  {p.awards.potd || p.awards.gk || p.awards.def || p.awards.mid || p.awards.att ? (
                    <View style={[styles.metaRow, { marginTop: 8 }]}>
                      <Text style={styles.meta}>
                        <Text style={styles.metaK}>Awards</Text>{" "}
                        {[
                          p.awards.potd ? `POTD ${p.awards.potd}` : null,
                          p.awards.gk ? `GOTD ${p.awards.gk}` : null,
                          p.awards.def ? `DEF ${p.awards.def}` : null,
                          p.awards.mid ? `MID ${p.awards.mid}` : null,
                          p.awards.att ? `ATT ${p.awards.att}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: themeColor().bg },
  content: { padding: 20, paddingBottom: 40 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_400Regular", padding: 0 },

  filterLabel: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().muted,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
  },
  chipOn: { borderColor: themeColor().pitch, backgroundColor: themeColor().pitchPanel },
  chipText: { color: themeColor().muted, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  chipTextOn: { color: themeColor().pitchText },

  centerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  centerText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  errText: { marginTop: 16, color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  emptyText: { marginTop: 16, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  list: { marginTop: 16, gap: 12 },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "800" },
  username: { marginTop: 4, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  meta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  metaValue: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  metaMuted: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  metaK: { color: themeColor().muted, fontWeight: "800" },
  metaSep: { color: themeColor().muted, fontWeight: "900" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}


