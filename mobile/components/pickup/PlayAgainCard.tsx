import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useFeatureFlag } from "@/context/FeatureFlagsContext";
import { track } from "@/lib/analytics/analytics";
import { askHostToRepeat, fetchPlayAgain, type PlayAgainInfo } from "@/lib/playAgain";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/**
 * "Play with this group again" on a finished game. Behind the 'play_again' flag.
 * The host sets up the next game (same field, time and price, a week later). A player from the game can ask the host.
 */
export default function PlayAgainCard({ runId }: { runId: string }) {
  useThemedStyles(publish_styles);
  const on = useFeatureFlag("play_again");
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [info, setInfo] = useState<PlayAgainInfo | null>(null);
  const [asked, setAsked] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    if (!on || !token || !runId) return;
    let cancelled = false;
    void fetchPlayAgain(token, runId).then((r) => {
      if (!cancelled) setInfo(r.ok ? r.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [on, token, runId]);

  if (!on || !info?.eligible || !info.role) return null;

  if (info.role === "host") {
    const n = info.previous_players;
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Play with this group again</Text>
        <Text style={styles.sub}>
          Same field, time and price, one week later.{n > 0 ? ` ${n} ${n === 1 ? "player from this game hears" : "players from this game hear"} first.` : ""}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          onPress={() => {
            track("play_again_tapped", { run_id: runId, role: "host" });
            router.push({ pathname: "/session-create", params: { repeat_from: runId } });
          }}
        >
          <Text style={styles.buttonText}>Set up next week</Text>
        </Pressable>
      </View>
    );
  }

  const ask = async () => {
    if (!token || asked === "busy" || asked === "done") return;
    track("play_again_tapped", { run_id: runId, role: "attendee" });
    setAsked("busy");
    const r = await askHostToRepeat(token, runId);
    setAsked(r.ok ? "done" : "error");
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Play with this group again</Text>
      <Text style={styles.sub}>{asked === "done" ? "Sent. The host will see that players want another game." : "Ask the host to run this game again."}</Text>
      {asked === "error" ? <Text style={styles.err}>We couldn’t send that. Try again.</Text> : null}
      {asked !== "done" ? (
        <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.88 }]} onPress={() => void ask()} disabled={asked === "busy"} accessibilityRole="button">
          {asked === "busy" ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.buttonText}>Ask the host</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    card: { padding: 16, borderRadius: radius.card, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().card, gap: 8 },
    title: { color: themeColor().text, fontSize: 17, ...headline },
    sub: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
    err: { color: themeColor().coralText, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    button: { alignSelf: "flex-start", minHeight: 44, minWidth: 140, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: themeColor().pitch, alignItems: "center", justifyContent: "center" },
    buttonText: { color: themeColor().onPitch, fontSize: 15, fontFamily: "Inter_700Bold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
