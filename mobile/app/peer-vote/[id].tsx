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
import { StarRating } from "@/components/StarRating";
import { fetchPlayerCards, type PlayerCard } from "@/lib/starRatings";

import { headline, themeColor, useThemedStyles } from "@/theme";
type AttendeeRow = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  card: PlayerCard | null;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export default function PeerVoteScreen() {
  const insets = useSafeAreaInsets();
  useThemedStyles(publish_s);

  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { supabase, session } = useAuth();
  const me = session?.user?.id ?? null;

  const [players, setPlayers] = useState<AttendeeRow[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !me || !sessionId) return;
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("session_attendance")
        .select("user_id")
        .eq("session_id", sessionId)
        .eq("status", "attended");

      if (qErr) {
        setError("Couldn't load the roster. Pull to retry.");
        setLoading(false);
        return;
      }

      const ids = ((data ?? []) as { user_id: string }[])
        .map((r) => r.user_id)
        .filter((uid) => uid && uid !== me);
      const [{ data: profRows, error: profErr }, cards] = await Promise.all([
        ids.length
          ? supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", ids)
          : Promise.resolve({ data: [] as ProfileRow[], error: null }),
        fetchPlayerCards(supabase, ids),
      ]);
      if (profErr) console.warn("[peer-vote] profiles:", profErr.message);

      const profById = new Map(((profRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));
      setPlayers(
        ids.map((uid) => {
          const p = profById.get(uid);
          const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
          return {
            user_id: uid,
            name: name || "Player",
            avatar_url: p?.avatar_url ?? null,
            card: cards.get(uid) ?? null,
          };
        }),
      );
      setLoading(false);
    })();
  }, [supabase, me, sessionId]);

  const toggle = (id: string) =>
    setPicks((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length < 3
          ? [...cur, id]
          : cur,
    );

  const submit = async () => {
    if (picks.length !== 3 || submitting || !supabase || !me || !sessionId) return;
    setSubmitting(true);
    setError(null);

    const rows = picks.map((votee_id, i) => ({
      session_id: sessionId,
      voter_id: me,
      votee_id,
      rank: i + 1,
    }));

    const { error: insErr } = await supabase.from("peer_votes").insert(rows);
    setSubmitting(false);

    if (insErr) {
      // 23505 = unique violation — already voted. Treat as done.
      if (insErr.code === "23505") { router.back(); return; }
      setError("Voting is closed for this session.");
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
      <Text style={s.eyebrow}>SESSION COMPLETE</Text>
      <Text style={s.title}>Who were the three best?</Text>
      <Text style={s.sub}>
        Nobody sees your picks — not the organizer, not the players. Tap in order.
      </Text>

      <FlatList
        data={players}
        keyExtractor={(p) => p.user_id}
        style={{ marginTop: 20 }}
        renderItem={({ item }) => {
          const rank = picks.indexOf(item.user_id);
          const picked = rank >= 0;
          const full = picks.length === 3 && !picked;
          return (
            <Pressable
              onPress={() => toggle(item.user_id)}
              disabled={full}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked, disabled: full }}
              style={[s.row, picked && s.rowPicked, full && s.rowDim]}
            >
              <View style={[s.slot, picked && s.slotPicked]}>
                <Text style={[s.slotText, picked && s.slotTextPicked]}>
                  {picked ? String(rank + 1) : ""}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.name}</Text>
                {item.card ? (
                  <StarRating
                    value={item.card.star}
                    provisional={item.card.provisional}
                    size="sm"
                    style={s.stars}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      {error ? <Text style={s.error}>{error}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={picks.length !== 3 || submitting}
        style={[s.cta, picks.length !== 3 && s.ctaOff]}
      >
        <Text style={s.ctaText}>
          {submitting ? "Submitting…" : `Submit ${picks.length}/3`}
        </Text>
      </Pressable>
    </View>
  );
}

function make_s() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: themeColor().card, padding: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  eyebrow: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  title: { color: themeColor().text, fontSize: 32, ...headline, marginTop: 4 },
  sub: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  rowPicked: { borderBottomColor: themeColor().pitchText },
  rowDim: { opacity: 0.35 },
  slot: {
    width: 32,
    height: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
  },
  slotPicked: { backgroundColor: themeColor().pitch, borderColor: themeColor().pitchText },
  slotText: { color: themeColor().muted, fontWeight: "700" },
  slotTextPicked: { color: themeColor().onPitch },
  name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  stars: { marginTop: 4 },
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

