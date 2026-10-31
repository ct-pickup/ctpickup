import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { themeColor, useThemedStyles } from "@/theme";

const RING = 68;
const STROKE = 6;

/** Reliability ring: how many of the games needed to settle a rating the player has, as a percent. */
export function ReliabilityRing({ percent }: { percent: number }) {
  useThemedStyles(publish_styles);
  const c = themeColor();
  const r = (RING - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Reliability ${clamped} percent`}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={c.onInk} strokeOpacity={0.2} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={c.pitch}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${(circ * clamped) / 100} ${circ}`}
          rotation={-90}
          origin={`${RING / 2}, ${RING / 2}`}
        />
      </Svg>
      <Text allowFontScaling={false} style={styles.pct}>
        {clamped}%
      </Text>
      <Text allowFontScaling={false} style={styles.label}>
        Reliable
      </Text>
    </View>
  );
}

/** Thin Provisional to Settled bar with the games so far. */
export function SettleProgress({ progress, gamesLabel }: { progress: number; gamesLabel: string }) {
  useThemedStyles(publish_styles);
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.barWrap} accessible accessibilityLabel={`${gamesLabel}. Provisional to settled.`}>
      <View style={styles.barLabels}>
        <Text allowFontScaling={false} style={styles.barText}>
          Provisional
        </Text>
        <Text allowFontScaling={false} style={styles.barText}>
          Settled
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(p * 100)}%` }]} />
      </View>
      <Text allowFontScaling={false} style={styles.games}>
        {gamesLabel}
      </Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
    pct: { color: c.onInk, fontSize: 16, lineHeight: 18, fontFamily: "Inter_700Bold", fontWeight: "700" },
    label: { color: c.onInk, opacity: 0.7, fontSize: 9, lineHeight: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    barWrap: { marginTop: 10, gap: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between" },
    barText: { color: c.onInk, opacity: 0.7, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    track: { height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" },
    fill: { height: 4, borderRadius: 2, backgroundColor: c.pitch },
    games: { color: c.onInk, opacity: 0.8, fontSize: 12, fontFamily: "Inter_500Medium", fontWeight: "500" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
