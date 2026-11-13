import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { RATED_GAMES_HELP } from "@/lib/ratingDisplayCore";

import { themeColor, useThemedStyles } from "@/theme";

const RING = 68;
const STROKE = 6;

/** "Shows up" ring: how reliably the player turns up to games they join, as a percent. */
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
      accessibilityLabel={`Shows up ${clamped} percent`}
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
        Shows up
      </Text>
    </View>
  );
}

/** Thin Provisional to Settled bar with the games so far and how many more lock the rating. The fill animates in (not with Reduce Motion). */
export function SettleProgress({ progress, gamesLabel, lockLabel, replayKey = 0 }: { progress: number; gamesLabel: string; lockLabel?: string | null; replayKey?: number }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const p = Math.max(0, Math.min(1, progress));
  // Fills from empty to p when it mounts or p changes; straight to p under Reduce Motion.
  const fill = useDerivedValue(
    () => (reduceMotion ? p : withSequence(withTiming(0, { duration: 0 }), withTiming(p, { duration: MOTION.duration.slow, easing: Easing.out(Easing.cubic) }))),
    [p, reduceMotion, replayKey],
  );
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));
  return (
    <View style={styles.barWrap} accessible accessibilityLabel={`${gamesLabel}. ${lockLabel ?? "Provisional to settled."}`}>
      <View style={styles.barLabels}>
        <Text allowFontScaling={false} style={styles.barText}>
          Provisional
        </Text>
        <Text allowFontScaling={false} style={styles.barText}>
          Settled
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
      <View style={styles.barLabels}>
        <Text allowFontScaling={false} style={styles.games}>
          {gamesLabel}
        </Text>
        {lockLabel ? (
          <Text allowFontScaling={false} style={styles.lock} numberOfLines={1}>
            {lockLabel}
          </Text>
        ) : null}
      </View>
      <Text style={styles.help}>{RATED_GAMES_HELP}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
    pct: { color: c.onInk, fontSize: 16, lineHeight: 18, fontFamily: "Inter_700Bold", fontWeight: "700" },
    label: { color: c.onInk, opacity: 0.7, fontSize: 8, lineHeight: 10, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    barWrap: { marginTop: 10, gap: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between" },
    barText: { color: c.onInk, opacity: 0.7, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    track: { height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" },
    fill: { height: 4, borderRadius: 2, backgroundColor: c.pitch },
    games: { color: c.onInk, opacity: 0.8, fontSize: 12, fontFamily: "Inter_500Medium", fontWeight: "500" },
    help: { color: c.onInk, opacity: 0.6, fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 2 },
    lock: { color: c.pitch, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600", flexShrink: 1, textAlign: "right" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
