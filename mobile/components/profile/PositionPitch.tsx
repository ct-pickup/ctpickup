import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";

import { useChalkStroke } from "@/components/chalk/stroke";
import { PITCH_SPOT_NAME, PITCH_SPOT_XY, type PitchSpot } from "@/lib/pitchPosition";
import { themeColor, useThemedStyles } from "@/theme";

const HEIGHT = 160;
const VB_W = 68;
const VB_H = 105;
const DOT_R = 3.6;

type PositionPitchProps = {
  /** Filled dot. Null when the player has not set a position. */
  primary: PitchSpot | null;
  /** Outlined dots. The primary spot is never repeated here. */
  others?: PitchSpot[];
  /** Smaller pitch and type for the Profile tile. */
  compact?: boolean;
};

/**
 * Small vertical chalk pitch showing only where this player plays: the primary
 * spot filled, any other positions outlined. Unused spots are not drawn, so the
 * pitch reads as their position rather than a formation chart.
 */
export default function PositionPitch({ primary, others = [], compact = false }: PositionPitchProps) {
  useThemedStyles(publish_styles);
  const height = compact ? 76 : HEIGHT;
  const width = Math.round((height * VB_W) / VB_H);
  const chalk = useChalkStroke("line", { width: 0.9 });
  const c = themeColor();

  const secondary = others.filter((s) => s !== primary);
  const label = primary
    ? `Plays ${PITCH_SPOT_NAME[primary]}${secondary.length ? `, also ${secondary.map((s) => PITCH_SPOT_NAME[s]).join(", ")}` : ""}`
    : "No position set";

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Svg width={width} height={height} viewBox={`-1 -1 ${VB_W + 2} ${VB_H + 2}`} accessible accessibilityLabel={label}>
        <Rect x={0} y={0} width={VB_W} height={VB_H} rx={1.5} {...chalk} />
        <Line x1={0} y1={VB_H / 2} x2={VB_W} y2={VB_H / 2} {...chalk} />
        <Circle cx={VB_W / 2} cy={VB_H / 2} r={9.15} {...chalk} />
        <Rect x={(VB_W - 40.3) / 2} y={0} width={40.3} height={16.5} {...chalk} />
        <Rect x={(VB_W - 18.3) / 2} y={0} width={18.3} height={5.5} {...chalk} />
        <Rect x={(VB_W - 40.3) / 2} y={VB_H - 16.5} width={40.3} height={16.5} {...chalk} />
        <Rect x={(VB_W - 18.3) / 2} y={VB_H - 5.5} width={18.3} height={5.5} {...chalk} />

        {secondary.map((s) => {
          const { x, y } = PITCH_SPOT_XY[s];
          return <Circle key={s} cx={x} cy={y} r={DOT_R} fill="none" stroke={c.muted} strokeWidth={0.9} />;
        })}

        {primary ? (
          <Circle cx={PITCH_SPOT_XY[primary].x} cy={PITCH_SPOT_XY[primary].y} r={DOT_R + 0.6} fill={c.accent} />
        ) : null}
      </Svg>

      <View style={styles.text}>
        {primary ? (
          <>
            <Text style={styles.code}>{primary}</Text>
            <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : undefined}>
              {PITCH_SPOT_NAME[primary]}
            </Text>
            {secondary.length > 0 && !compact ? (
              <Text style={styles.also}>Also plays {secondary.join(", ")}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.name}>Add your position from Edit profile in Settings.</Text>
        )}
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 20 },
    rowCompact: { gap: 10 },
    text: { flex: 1 },
    nameCompact: { fontSize: 12 },
    code: { color: themeColor().text, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700" },
    name: { marginTop: 2, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500" },
    also: { marginTop: 6, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
