import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { POINTS } from "@/lib/pickup/points";
import { SEASON_PRIZE_USD, seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { enterSeason, markSeasonIntroSeen, SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const COUNTDOWN_SECONDS = 5;
const PLEDGE =
  "I will play fairly. I won't fake games, results or votes, or work with others to inflate points. I understand cheating can lead to disqualification and a ban.";

/**
 * "Win the season" intro, shown right after sign-in or signup and before the waiver (the tabs layout redirects here).
 * For the first 5 seconds there is nothing to tap; then "Enter the season" (needs the pledge ticked) and "Skip".
 * Behind SEASON_PRIZE_ENABLED.
 */
export default function SeasonPrizeScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const token = session?.access_token ?? null;
  const season = seasonWindowFor();

  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [pledged, setPledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduceMotion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: COUNTDOWN_SECONDS * 1000, easing: Easing.linear, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, progress]);

  // The screen can only be left with the buttons: no swipe back (set on the route) and no Android back.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const ready = secondsLeft === 0;

  async function finish() {
    if (userId) await markSeasonIntroSeen(userId);
    router.replace("/(tabs)");
  }

  async function enter() {
    if (!pledged || busy) return;
    setBusy(true);
    setError(null);
    const res = await enterSeason(token);
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    await finish();
  }

  function openRules() {
    const origin = siteOrigin();
    if (origin) void Linking.openURL(`${origin}/season-rules`);
  }

  if (!SEASON_PRIZE_ENABLED) {
    // Flag off: never show. (The layout does not send anyone here, this only covers a stray deep link.)
    return null;
  }

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 16) + 8, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <ScrollView contentContainerStyle={styles.scroll} scrollEnabled={ready} bounces={false}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{season.label}</Text>
          <Text style={styles.title}>Win the season.</Text>
          <Text style={styles.prize}>First place earns ${SEASON_PRIZE_USD}.</Text>
          <Text style={styles.dates}>
            {season.startText} to {season.endText}
          </Text>
          <View style={styles.rule} />
          <Text style={styles.points}>
            {POINTS.played} pts for playing, {POINTS.win} for a win, {POINTS.draw} for a draw, {POINTS.potd} for Player of the Day
          </Text>
          <Text style={styles.noPurchase}>No purchase necessary.</Text>
          <Pressable onPress={openRules} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Read the official rules</Text>
          </Pressable>
        </View>

        {!ready ? (
          <View style={styles.countdown} accessibilityLiveRegion="polite">
            <Text style={styles.countdownText}>You can continue in {secondsLeft}s</Text>
            {reduceMotion ? null : (
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.actions}>
            <Pressable
              onPress={() => setPledged((v) => !v)}
              style={styles.pledgeRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: pledged }}
              accessibilityLabel={PLEDGE}
            >
              <View style={[styles.box, pledged && styles.boxOn]}>{pledged ? <Text style={styles.tick}>✓</Text> : null}</View>
              <Text style={styles.pledgeText}>{PLEDGE}</Text>
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={() => void enter()}
              disabled={!pledged || busy}
              style={({ pressed }) => [styles.enterBtn, (!pledged || busy) && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !pledged || busy }}
            >
              <Text style={styles.enterText}>{busy ? "Entering…" : error ? "Try again" : "Enter the season"}</Text>
            </Pressable>
            <Pressable onPress={() => void finish()} disabled={busy} hitSlop={8} style={styles.skipBtn} accessibilityRole="button">
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 20 },
    scroll: { flexGrow: 1, justifyContent: "center", gap: 20 },
    card: { backgroundColor: c.pitch, borderRadius: radius.playerCard, padding: 24, gap: 6 },
    eyebrow: { color: c.onPitch, opacity: 0.8, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    title: { color: c.onPitch, fontSize: 40, lineHeight: 44, ...headline },
    prize: { color: c.onPitch, fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 4 },
    dates: { color: c.onPitch, opacity: 0.85, fontSize: 15, fontFamily: "Inter_500Medium", marginTop: 4 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.onPitch, opacity: 0.35, marginVertical: 14 },
    points: { color: c.onPitch, fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 22 },
    noPurchase: { color: c.onPitch, opacity: 0.85, fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 10 },
    link: { color: c.onPitch, fontSize: 14, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline", marginTop: 4 },
    countdown: { alignItems: "center", gap: 10 },
    countdownText: { color: c.muted, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    track: { alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" },
    fill: { height: 4, backgroundColor: c.accent },
    actions: { gap: 14 },
    pledgeRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.muted, alignItems: "center", justifyContent: "center", marginTop: 1 },
    boxOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    tick: { color: c.onPitch, fontSize: 15, fontFamily: "Inter_700Bold" },
    pledgeText: { flex: 1, color: c.text, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
    error: { color: c.coralText, fontSize: 13, fontFamily: "Inter_500Medium" },
    enterBtn: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    enterText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    disabled: { opacity: 0.35 },
    pressed: { opacity: 0.85 },
    skipBtn: { alignSelf: "center", paddingVertical: 8 },
    skipText: { color: c.muted, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
