import { forwardRef, useEffect } from "react";
import { Image, PixelRatio, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { ChalkCenterCircle } from "@/components/chalk";
import { StarRating } from "@/components/StarRating";
import { STORY_HEIGHT, STORY_WIDTH } from "@/lib/shareStory";
import { displayNumeral, headline, shareCardColor as C, trackedLabel } from "@/theme";

export type ProfileShareData = {
  name: string;
  star: number | null;
  starProvisional: boolean;
  /** "CB · Westport" */
  positionTown: string | null;
  games: number;
  winPct: number | null;
  potd: number;
  photo: string | null;
};

/**
 * Player card story image. Same 360×640 grid, scrim and wordmark as the season ShareStoryCard, and always dark.
 * Shows only public profile facts: no score, tier, reliability or date of birth.
 */
const ProfileShareCard = forwardRef<View, { data: ProfileShareData; onReady?: () => void }>(function ProfileShareCard(
  { data, onReady },
  ref,
) {
  const width = STORY_WIDTH / PixelRatio.get();
  const height = STORY_HEIGHT / PixelRatio.get();
  const u = width / 360;
  const n = (v: number) => Math.round(v * u * 10) / 10;

  useEffect(() => {
    if (!data.photo) onReady?.();
  }, [data.photo, onReady]);

  const stats: Array<{ label: string; value: string }> = [
    { label: "Games", value: String(data.games) },
    { label: "Win %", value: data.winPct == null ? "—" : `${data.winPct}%` },
    { label: "POTD", value: String(data.potd) },
  ];

  return (
    <View ref={ref} collapsable={false} style={{ width, height, backgroundColor: data.photo ? C.bg : C.fallbackBg }}>
      {data.photo ? (
        <Image source={{ uri: data.photo }} alt="" style={StyleSheet.absoluteFill} resizeMode="cover" onLoadEnd={onReady} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.chalkWrap, { paddingBottom: n(220) }]}>
          <ChalkCenterCircle px={n(300)} color="onPitchPanel" dark />
        </View>
      )}

      <Svg style={StyleSheet.absoluteFill} width={width} height={height} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="profileScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.scrim} stopOpacity={data.photo ? 0.55 : 0.2} />
            <Stop offset="0.2" stopColor={C.scrim} stopOpacity={0} />
            <Stop offset="0.38" stopColor={C.scrim} stopOpacity={data.photo ? 0.1 : 0} />
            <Stop offset="0.62" stopColor={C.scrim} stopOpacity={data.photo ? 0.84 : 0.5} />
            <Stop offset="1" stopColor={C.scrim} stopOpacity={data.photo ? 0.94 : 0.7} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#profileScrim)" />
      </Svg>

      <View style={[styles.top, { top: n(92), left: n(32), right: n(32) }]}>
        <View style={[styles.brandDot, { width: n(10), height: n(10), borderRadius: n(5), marginRight: n(8) }]} />
        <Text allowFontScaling={false} style={[styles.wordmark, { fontSize: n(22) }]}>
          CT Pickup
        </Text>
      </View>

      <View style={[styles.bottom, { left: n(32), right: n(32), bottom: n(112) }]}>
        {data.star != null ? (
          <StarRating
            value={data.star}
            provisional={data.starProvisional}
            tone="onPhoto"
            px={n(22)}
            style={{ marginBottom: n(14) }}
          />
        ) : null}

        <Text
          allowFontScaling={false}
          numberOfLines={2}
          adjustsFontSizeToFit
          style={[styles.name, { fontSize: n(52), lineHeight: n(54) }]}
        >
          {data.name}
        </Text>
        {data.positionTown ? (
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.meta, { fontSize: n(17), marginTop: n(10) }]}>
            {data.positionTown}
          </Text>
        ) : null}

        <View style={[styles.rule, { height: Math.max(1, n(1)), marginTop: n(24), marginBottom: n(18) }]} />
        <View style={styles.statsRow}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text allowFontScaling={false} numberOfLines={1} style={[displayNumeral(n(48)), styles.statValue]}>
                {s.value}
              </Text>
              <Text allowFontScaling={false} style={[trackedLabel(n(13)), styles.statLabel, { marginTop: n(6) }]}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  chalkWrap: { alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", flexDirection: "row", alignItems: "center" },
  brandDot: { backgroundColor: C.accent },
  wordmark: { fontFamily: headline.fontFamily, color: C.text },
  bottom: { position: "absolute" },
  name: { fontFamily: headline.fontFamily, color: C.text },
  meta: { fontFamily: "Inter_600SemiBold", color: C.muted },
  rule: { backgroundColor: C.faint },
  statsRow: { flexDirection: "row" },
  stat: { flex: 1 },
  statValue: { color: C.text, includeFontPadding: false },
  statLabel: { color: C.muted },
});

export default ProfileShareCard;
