import { goBack } from "@/lib/goBack";
import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { siteOrigin } from "@/lib/env";
import { POINTS } from "@/lib/pickup/points";
import { SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_RULES_VERSION, SEASON_PRIZE_USD, seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { SEASON_PRIZE_ENABLED } from "@/lib/seasonPrize";
import { themeColor, useThemedStyles } from "@/theme";
import { APPLE_DISCLAIMER, seasonRuleSections, splitPlaceholders } from "@shared/seasonRules";

function Rich({ text, style }: { text: string; style: object }) {
  return (
    <Text style={style}>
      {splitPlaceholders(text).map((part, i) =>
        part.placeholder ? (
          <Text key={i} style={placeholderStyle()}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

function placeholderStyle() {
  const c = themeColor();
  return { color: c.text, fontFamily: "Inter_700Bold", fontWeight: "700" as const, backgroundColor: c.overlaySubtle };
}

/** The official season prize rules, in the app. Same text as the website (shared/seasonRules.ts). Behind the season prize flag. */
export default function SeasonRulesScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();

  if (!SEASON_PRIZE_ENABLED) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>This is not available yet.</Text>
      </View>
    );
  }

  const season = seasonWindowFor();
  const sections = seasonRuleSections({
    prizeUsd: SEASON_PRIZE_USD,
    minGames: SEASON_PRIZE_MIN_GAMES,
    points: POINTS,
    season: { label: season.label, startText: season.startText, endText: season.endText },
    rulesVersion: SEASON_PRIZE_RULES_VERSION,
  });

  function openPath(path: string) {
    const origin = siteOrigin();
    if (origin) void Linking.openURL(`${origin}${path}`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Season Prize: Official Rules</Text>
      <Text style={styles.meta}>Rules version {SEASON_PRIZE_RULES_VERSION}</Text>
      <Text style={styles.apple}>{APPLE_DISCLAIMER}</Text>

      {sections.map((s) => (
        <View key={s.id} style={styles.section}>
          <Text style={styles.h2}>{s.title}</Text>
          {s.blocks.map((b, i) =>
            b.kind === "p" ? (
              <Rich key={i} style={styles.body} text={b.text} />
            ) : b.kind === "link" ? (
              <Pressable key={i} onPress={() => openPath(b.path)} hitSlop={8} accessibilityRole="link">
                <Text style={styles.link}>{b.label}</Text>
              </Pressable>
            ) : (
              <View key={i} style={styles.list}>
                {b.items.map((it) => (
                  <Rich key={it} style={styles.body} text={`• ${it}`} />
                ))}
              </View>
            ),
          )}
        </View>
      ))}
      <Pressable onPress={() => goBack(router, "/(tabs)/account")} hitSlop={8} style={styles.back} accessibilityRole="button">
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, paddingBottom: 48, gap: 14 },
    title: { color: c.text, fontSize: 22, fontFamily: "Inter_700Bold", fontWeight: "700" },
    meta: { color: c.muted, fontSize: 12, fontFamily: "Inter_400Regular" },
    apple: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    section: { gap: 8 },
    h2: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    body: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
    list: { gap: 4, paddingLeft: 4 },
    link: { color: c.pitchText, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    back: { alignSelf: "center", paddingVertical: 12 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
