import { forwardRef, useEffect } from "react";
import { Image, PixelRatio, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { ChalkCenterCircle } from "@/components/chalk";
import { StarRating } from "@/components/StarRating";
import { longDateEt, outcomeWord, type Outcome } from "@/lib/season";
import { STORY_HEIGHT, STORY_WIDTH } from "@/lib/shareStory";
import { displayNumeral, headline, radius, shareCardColor as C, trackedLabel } from "@/theme";

export type ShareStoryData = {
  field: string;
  town: string | null;
  start_at: string | null;
  outcome: Outcome | null;
  score: string | null;
  potd: boolean;
  position: string | null;
  star: number | null;
  starProvisional: boolean;
  photo: string | null;
};

/**
 * Laid out on a 360×640 grid scaled so the native view is exactly 1080×1920 device pixels; that keeps
 * text sharp in the capture on every pixel density. Content stays inside Instagram's story safe zones
 * (about 90 units clear at the top and 110 at the bottom).
 */
const ShareStoryCard = forwardRef<View, { data: ShareStoryData; onReady?: () => void }>(function ShareStoryCard(
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

  const { outcome } = data;
  const bigText = data.score ?? (outcome ? outcomeWord(outcome) : "Full time");
  const bigSize = data.score ? 156 : 112;
  const bigColor = !data.score && outcome === "W" ? C.accent : C.text;
  const meta = [longDateEt(data.start_at), data.town].filter(Boolean).join("  \u00b7  ");
  const showFooter = data.star != null || Boolean(data.position);

  return (
    <View ref={ref} collapsable={false} style={{ width, height, backgroundColor: data.photo ? C.bg : C.fallbackBg }}>
      {data.photo ? (
        <Image
          source={{ uri: data.photo }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoadEnd={onReady}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.chalkWrap, { paddingBottom: n(220) }]}>
          <ChalkCenterCircle px={n(300)} color="onPitchPanel" dark />
        </View>
      )}

      <Svg style={StyleSheet.absoluteFill} width={width} height={height} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="storyScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.scrim} stopOpacity={data.photo ? 0.55 : 0.2} />
            <Stop offset="0.2" stopColor={C.scrim} stopOpacity={0} />
            <Stop offset="0.38" stopColor={C.scrim} stopOpacity={data.photo ? 0.1 : 0} />
            <Stop offset="0.66" stopColor={C.scrim} stopOpacity={data.photo ? 0.84 : 0.5} />
            <Stop offset="1" stopColor={C.scrim} stopOpacity={data.photo ? 0.94 : 0.7} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#storyScrim)" />
      </Svg>

      <View style={[styles.top, { top: n(92), left: n(32), right: n(32) }]}>
        <View style={[styles.brandDot, { width: n(10), height: n(10), borderRadius: n(5), marginRight: n(8) }]} />
        <Text allowFontScaling={false} style={[styles.wordmark, { fontSize: n(22) }]}>
          CT Pickup
        </Text>
      </View>

      <View style={[styles.bottom, { left: n(32), right: n(32), bottom: n(112) }]}>
        <View style={[styles.tagRow, { gap: n(8), marginBottom: n(12) }]}>
          {outcome && data.score ? <ResultTag outcome={outcome} n={n} /> : null}
          {data.potd ? (
            <View style={[styles.potdTag, { paddingHorizontal: n(12), paddingVertical: n(6) }]}>
              <Text allowFontScaling={false} style={[trackedLabel(n(13)), { color: C.accent }]}>
                Player of the Day
              </Text>
            </View>
          ) : null}
        </View>

        <Text
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[displayNumeral(n(bigSize)), styles.big, { color: bigColor }]}
        >
          {bigText}
        </Text>

        <Text allowFontScaling={false} numberOfLines={2} style={[styles.field, { fontSize: n(30), lineHeight: n(34), marginTop: n(16) }]}>
          {data.field}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.meta, { fontSize: n(15), marginTop: n(8) }]}>
          {meta}
        </Text>

        {showFooter ? (
          <>
            <View style={[styles.rule, { height: Math.max(1, n(1)), marginTop: n(22), marginBottom: n(16) }]} />
            <View style={styles.footer}>
              {data.star != null ? (
                <StarRating value={data.star} provisional={data.starProvisional} tone="onPhoto" px={n(20)} />
              ) : (
                <View />
              )}
              {data.position ? (
                <Text allowFontScaling={false} style={[styles.meta, { fontSize: n(15) }]}>
                  {data.position}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
});

function ResultTag({ outcome, n }: { outcome: Outcome; n: (v: number) => number }) {
  const win = outcome === "W";
  return (
    <View
      style={[
        styles.resultTag,
        { paddingHorizontal: n(12), paddingVertical: n(6) },
        win ? styles.resultWin : outcome === "L" ? styles.resultLoss : styles.resultDraw,
      ]}
    >
      <Text allowFontScaling={false} style={[trackedLabel(n(13)), { color: win ? C.onAccent : C.text }]}>
        {outcomeWord(outcome)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chalkWrap: { alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", flexDirection: "row", alignItems: "center" },
  brandDot: { backgroundColor: C.accent },
  wordmark: { fontFamily: headline.fontFamily, color: C.text },
  bottom: { position: "absolute" },
  tagRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  resultTag: { borderRadius: radius.pill, borderWidth: 1.5 },
  resultWin: { backgroundColor: C.accent, borderColor: C.accent },
  resultLoss: { backgroundColor: C.faint, borderColor: C.faint },
  resultDraw: { borderColor: C.text },
  potdTag: { borderRadius: radius.pill, borderWidth: 1.5, borderColor: C.accent },
  big: { includeFontPadding: false },
  field: { fontFamily: headline.fontFamily, color: C.text },
  meta: { fontFamily: "Inter_600SemiBold", color: C.muted },
  rule: { backgroundColor: C.faint },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

export default ShareStoryCard;
