import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { StarRating } from "@/components/StarRating";
import { averageStars, fetchCardStats, gamesInRecord, performance, recordLabel, type CardStats } from "@/lib/playerStats";
import { headline, themeColor, useThemedStyles } from "@/theme";

/**
 * Record, average partner, average opponent and performance against expectation, on a player's profile.
 * Shown for everyone; hides itself when there are no games with teams yet. Never shows a raw rating.
 */
export default function PlayerGameStats({ userId }: { userId: string }) {
  useThemedStyles(publish_styles);
  const { supabase } = useAuth();
  const [stats, setStats] = useState<CardStats | null>(null);

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    void fetchCardStats(supabase, userId).then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  if (!stats || gamesInRecord(stats) === 0) return null;
  const partner = averageStars(stats.partnerStars, stats.partnerGames, stats.minGames);
  const opponent = averageStars(stats.opponentStars, stats.opponentGames, stats.minGames);
  const perf = performance(stats);

  return (
    <View style={styles.card} accessibilityLabel="Game stats">
      <Text style={styles.title}>Games</Text>
      <Row label="Record (W-D-L)" value={<Text style={styles.value}>{recordLabel(stats)}</Text>} />
      <Row label="Avg teammate" value={partner != null ? <StarRating value={partner} size="sm" showValue={false} showLevel={false} /> : <Text style={styles.muted}>Not enough games yet</Text>} />
      <Row label="Avg opponent" value={opponent != null ? <StarRating value={opponent} size="sm" showValue={false} showLevel={false} /> : <Text style={styles.muted}>Not enough games yet</Text>} />
      <Row
        label="Vs expected"
        last
        value={
          <View style={styles.perf}>
            <Text style={[styles.value, perf.tone === "above" && styles.above, perf.tone === "below" && styles.below]}>{perf.label}</Text>
            {perf.detail ? <Text style={styles.muted}>{perf.detail}</Text> : null}
          </View>
        }
      />
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueWrap}>{value}</View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    card: { marginHorizontal: 16, marginBottom: 16, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle, overflow: "hidden" },
    title: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, color: themeColor().text, fontSize: 16, ...headline },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: themeColor().line },
    label: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    valueWrap: { flexShrink: 1, alignItems: "flex-end" },
    value: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_700Bold" },
    muted: { color: themeColor().muted, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "right" },
    perf: { alignItems: "flex-end", gap: 2 },
    above: { color: themeColor().pitchText },
    below: { color: themeColor().coralText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
