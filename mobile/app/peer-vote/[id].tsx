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
import { useAuth } from "@/context/AuthContext";

type AttendeeRow = {
  user_id: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  player_cards: { tier: string | null } | null;
};

export default function PeerVoteScreen() {
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
        .select("user_id, profiles(display_name, avatar_url), player_cards(tier)")
        .eq("session_id", sessionId)
        .eq("status", "attended");

      if (qErr) {
        setError("Couldn't load the roster. Pull to retry.");
      } else {
        setPlayers(
          ((data ?? []) as unknown as AttendeeRow[]).filter((p) => p.user_id !== me),
        );
      }
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
      <View style={[s.screen, s.center]}>
        <ActivityIndicator color="#E8B573" />
      </View>
    );
  }

  return (
    <View style={s.screen}>
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
                <Text style={s.name}>
                  {item.profiles?.display_name ?? "Player"}
                </Text>
                <Text style={s.tier}>
                  {(item.player_cards?.tier ?? "unrated").toUpperCase()}
                </Text>
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

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B1410", padding: 20, paddingTop: 56 },
  center: { alignItems: "center", justifyContent: "center" },
  eyebrow: { color: "#E8B573", fontSize: 11, letterSpacing: 3, fontWeight: "600" },
  title: { color: "#E6EDE7", fontSize: 30, fontWeight: "700", marginTop: 6 },
  sub: { color: "#7C8F84", fontSize: 14, marginTop: 8, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#28382F",
  },
  rowPicked: { borderBottomColor: "#E8B573" },
  rowDim: { opacity: 0.35 },
  slot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#28382F",
    alignItems: "center",
    justifyContent: "center",
  },
  slotPicked: { backgroundColor: "#E8B573", borderColor: "#E8B573" },
  slotText: { color: "#7C8F84", fontWeight: "700" },
  slotTextPicked: { color: "#14100A" },
  name: { color: "#E6EDE7", fontSize: 16, fontWeight: "600" },
  tier: { color: "#7C8F84", fontSize: 11, letterSpacing: 1.5, marginTop: 2 },
  error: { color: "#E86F5B", fontSize: 13, marginBottom: 10 },
  cta: {
    backgroundColor: "#E8B573",
    borderRadius: 3,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  ctaOff: { opacity: 0.3 },
  ctaText: {
    color: "#14100A",
    fontWeight: "700",
    letterSpacing: 1.5,
    fontSize: 14,
  },
});
