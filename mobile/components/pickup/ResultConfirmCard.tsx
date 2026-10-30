import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useFeatureFlag } from "@/context/FeatureFlagsContext";
import { confirmLine, confirmScore, fetchConfirmState, type ConfirmState } from "@/lib/resultConfirm";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/**
 * Confirm the posted score. Behind the 'rating_results' flag. The captain of each team (the first player named on it) confirms.
 * Everyone else sees where confirmation stands. Nothing is shown until a score has been posted.
 */
export default function ResultConfirmCard({ runId, score }: { runId: string; score: string | null }) {
  useThemedStyles(publish_styles);
  const on = useFeatureFlag("rating_results");
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [state, setState] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!on || !token || !runId) return;
    let cancelled = false;
    void fetchConfirmState(token, runId).then((r) => {
      if (!cancelled) setState(r.ok ? r.state : null);
    });
    return () => {
      cancelled = true;
    };
  }, [on, token, runId]);

  if (!on || !state) return null;
  const line = confirmLine(state);
  if (!line) return null;

  const confirm = async () => {
    if (!token || busy) return;
    setBusy(true);
    setFailed(false);
    const r = await confirmScore(token, runId);
    setBusy(false);
    if (r.ok) setState(r.state);
    else setFailed(true);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{state.can_confirm ? "Confirm the score" : "Score confirmation"}</Text>
      <Text style={styles.sub}>{state.can_confirm ? `${score ? `Final score ${score}. ` : ""}You are captain of Team ${state.my_team}. Confirm that this is right.` : line}</Text>
      {state.can_confirm ? <Text style={styles.sub}>{line}</Text> : null}
      {failed ? <Text style={styles.err}>We couldn’t save that. Try again.</Text> : null}
      {state.can_confirm ? (
        <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.88 }]} onPress={() => void confirm()} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.buttonText}>Confirm score</Text>}
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
