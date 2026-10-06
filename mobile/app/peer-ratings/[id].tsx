import { goBack } from "@/lib/goBack";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { HalfStarInput } from "@/components/HalfStarInput";
import { isValidHalfStar } from "@/lib/halfStars";

import { headline, themeColor, useThemedStyles } from "@/theme";

const NOT_ATTENDED = "Only players who attended can rate.";

type Player = { user_id: string; name: string };

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

/** Half-star peer rating sheet. [id] is the tier session id, same as peer-vote/[id]. */
export default function PeerRatingsScreen() {
  const insets = useSafeAreaInsets();
  useThemedStyles(publish_s);

  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { supabase, session } = useAuth();
  const me = session?.user?.id ?? null;

  const [players, setPlayers] = useState<Player[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attended, setAttended] = useState(true);

  useEffect(() => {
    if (!supabase || !me || !sessionId) return;
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", sessionId)
        .eq("status", "attended");

      if (qErr) {
        setError("Couldn't load the roster.");
        setLoading(false);
        return;
      }

      const roster = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      setAttended(roster.includes(me));
      const ids = roster
        .filter((uid) => uid && uid !== me);

      const [{ data: profRows, error: profErr }, { data: mine }] = await Promise.all([
        ids.length
          ? supabase.from("profiles").select("id,first_name,last_name").in("id", ids)
          : Promise.resolve({ data: [] as ProfileRow[], error: null }),
        supabase
          .from("peer_ratings")
          .select("ratee_id,stars")
          .eq("session_id", sessionId)
          .eq("rater_id", me),
      ]);
      if (profErr) console.warn("[peer-ratings] profiles:", profErr.message);

      const profById = new Map(((profRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));
      setPlayers(
        ids.map((uid) => {
          const p = profById.get(uid);
          const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
          return { user_id: uid, name: name || "Player" };
        }),
      );
      const prior: Record<string, number> = {};
      for (const r of (mine ?? []) as { ratee_id: string; stars: number | string }[]) {
        prior[r.ratee_id] = Number(r.stars);
      }
      setRatings(prior);
      setLoading(false);
    })();
  }, [supabase, me, sessionId]);

  const ratedCount = Object.values(ratings).filter(isValidHalfStar).length;

  const submit = async () => {
    if (ratedCount === 0 || submitting || !supabase || !me || !sessionId) return;
    setSubmitting(true);
    setError(null);

    const rows = Object.entries(ratings)
      .filter(([, stars]) => isValidHalfStar(stars))
      .map(([ratee_id, stars]) => ({ session_id: sessionId, rater_id: me, ratee_id, stars }));

    const { error: upErr } = await supabase
      .from("peer_ratings")
      .upsert(rows, { onConflict: "session_id,rater_id,ratee_id" });
    setSubmitting(false);

    if (upErr) {
      // 42501 = row-level security: only players marked attended can rate.
      setError(
        upErr.code === "42501"
          ? NOT_ATTENDED
          : "Couldn't save your ratings. Check your connection and try again.",
      );
      return;
    }
    router.back();
  };

  if (loading) {
    return (
      <View style={[s.screen, s.center, { paddingTop: insets.top + 8 }]}>
        <ActivityIndicator color={themeColor().pitchText} />
      </View>
    );
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.headerRow}>
        <Text style={s.eyebrow}>SESSION COMPLETE</Text>
        <Pressable onPress={() => goBack(router, "/(tabs)/sessions")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={s.close}>Close</Text>
        </Pressable>
      </View>
      <Text style={s.title}>Rate the players</Text>
      <Text style={s.sub}>
        Tap the left half of a star for a half. Nobody sees your ratings — not the organizer, not the players.
      </Text>

      <FlatList
        data={players}
        keyExtractor={(p) => p.user_id}
        style={{ marginTop: 20 }}
        renderItem={({ item }) => (
          <View style={s.row}>
            <Text style={s.name}>{item.name}</Text>
            <HalfStarInput
              value={ratings[item.user_id] ?? null}
              onChange={(v) => setRatings((cur) => ({ ...cur, [item.user_id]: v }))}
              label={`Rate ${item.name}`}
              style={s.stars}
            />
          </View>
        )}
      />

      {!attended ? <Text style={s.error}>{NOT_ATTENDED}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={ratedCount === 0 || submitting || !attended}
        style={[s.cta, (ratedCount === 0 || !attended) && s.ctaOff, { marginBottom: insets.bottom }]}
      >
        <Text style={s.ctaText}>{submitting ? "Saving…" : `Submit ${ratedCount}/${players.length}`}</Text>
      </Pressable>
    </View>
  );
}

function make_s() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().card, padding: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  close: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  title: { color: themeColor().text, fontSize: 32, ...headline, marginTop: 4 },
  sub: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 20 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  stars: { marginTop: 8 },
  error: { color: themeColor().coralText, fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  cta: {
    backgroundColor: themeColor().pitch,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  ctaOff: { opacity: 0.3 },
  ctaText: {
    color: themeColor().onPitch,
    fontWeight: "700",
    fontSize: 14, fontFamily: "Inter_700Bold",
  },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}
