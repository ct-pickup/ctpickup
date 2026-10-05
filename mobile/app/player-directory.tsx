import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import CtPlusPaywall from "@/components/ctplus/CtPlusPaywall";
import { StarRating } from "@/components/StarRating";
import { useAuth } from "@/context/AuthContext";
import { useCtPlus } from "@/context/CtPlusContext";
import { DiscoverRequestError, fetchDirectory, type DirectoryFilters } from "@/lib/discoverApi";
import { hapticTap } from "@/lib/haptics";
import { SKILL_STAR_RANGE } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";
import { DIRECTORY_DRIVE_CHOICES, DRIVE_BUCKET_LABEL, type DirectoryPlayer } from "@shared/discover";

const POSITIONS = ["Keeper", "Defender", "Midfielder", "Attacker"];
const LEVELS = Object.values(SKILL_STAR_RANGE).sort((a, b) => a.low - b.low);
const NO_FILTERS: DirectoryFilters = { position: null, minStar: null, maxStar: null, maxDrive: null };

/**
 * Player directory (CT+). The same members and card fields as Discover, filtered by position, level and drive time,
 * a page at a time. The CT+ gate is here in the app only; the server route is safe for any approved member.
 */
export default function PlayerDirectoryScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { session } = useAuth();
  const { enabled, isPlus } = useCtPlus();
  const token = session?.access_token ?? null;

  const [filters, setFilters] = useState<DirectoryFilters>(NO_FILTERS);
  const [players, setPlayers] = useState<DirectoryPlayer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  /** Guards against a slow earlier response landing after a newer filter change. */
  const requestId = useRef(0);

  const load = useCallback(
    async (f: DirectoryFilters, from: string | null) => {
      if (!token) return;
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchDirectory(token, f, from);
        if (id !== requestId.current) return;
        setPlayers((prev) => (from ? [...prev, ...page.players] : page.players));
        setCursor(page.nextCursor);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof DiscoverRequestError ? e.message : "We could not load players right now.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [token],
  );

  // First page, loaded once when the screen opens for a subscriber.
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !isPlus || !token || startedRef.current) return;
      startedRef.current = true;
      void load(NO_FILTERS, null);
    }, [enabled, isPlus, token, load]),
  );

  const apply = (next: DirectoryFilters) => {
    void hapticTap();
    setFilters(next);
    setPlayers([]);
    setCursor(null);
    void load(next, null);
  };

  if (!enabled) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>This is not available yet.</Text>
      </View>
    );
  }

  if (!isPlus) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>See every player near you</Text>
        <Text style={styles.body}>Browse the full player directory and filter by position, level and distance.</Text>
        <Pressable onPress={() => setPaywall(true)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.btnText}>Unlock with CT+</Text>
        </Pressable>
        <CtPlusPaywall design={null} data={null} visible={paywall} lead="See every player near you." onClose={() => setPaywall(false)} onPurchased={() => setPaywall(false)} />
      </View>
    );
  }

  const chip = (label: string, on: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chip("Any position", filters.position == null, () => apply({ ...filters, position: null }))}
          {POSITIONS.map((p) => chip(p, filters.position === p, () => apply({ ...filters, position: filters.position === p ? null : p })))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chip("Any level", filters.minStar == null, () => apply({ ...filters, minStar: null, maxStar: null }))}
          {LEVELS.map((r) => {
            const on = filters.minStar === r.low && filters.maxStar === r.high;
            return chip(`${r.low.toFixed(1)}–${r.high.toFixed(1)} ★`, on, () => apply({ ...filters, minStar: on ? null : r.low, maxStar: on ? null : r.high }), `lv${r.low}`);
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chip("Any distance", filters.maxDrive == null, () => apply({ ...filters, maxDrive: null }))}
          {DIRECTORY_DRIVE_CHOICES.map((m) => chip(`Within ${m} min`, filters.maxDrive === m, () => apply({ ...filters, maxDrive: filters.maxDrive === m ? null : m }), `d${m}`))}
        </ScrollView>
      </View>

      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (cursor && !loading) void load(filters, cursor);
        }}
        ListEmptyComponent={
          loading ? null : error ? (
            <View style={styles.empty}>
              <Text style={styles.body}>{error}</Text>
              <Pressable onPress={() => void load(filters, null)} accessibilityRole="button">
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[styles.body, styles.empty]}>No players match these filters.</Text>
          )
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 16 }} color={themeColor().text} /> : null}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/player/[id]", params: { id: item.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}${item.town ? `, ${item.town}` : ""}`}
          >
            {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} alt="" style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" /> : <View style={[styles.avatar, styles.avatarEmpty]} />}
            <View style={styles.rowBody}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.metaRow}>
                <StarRating value={item.star} size="sm" />
                {item.levelName ? <Text style={styles.meta}>{item.levelName}</Text> : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {[item.position, item.town, item.driveBucket ? DRIVE_BUCKET_LABEL[item.driveBucket] : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    title: { color: c.text, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center" },
    body: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
    btn: { alignSelf: "stretch", backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", marginTop: 8 },
    btnText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    filters: { paddingVertical: 8, gap: 8 },
    chipRow: { gap: 8, paddingHorizontal: 12 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { color: c.text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    chipTextOn: { color: c.onPitch },
    list: { paddingHorizontal: 12, paddingBottom: 32 },
    empty: { paddingVertical: 32, alignItems: "center", gap: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    avatar: { width: 52, height: 52, borderRadius: 26 },
    avatarEmpty: { backgroundColor: c.overlaySubtle },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    name: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    meta: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    link: { color: c.accent, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
