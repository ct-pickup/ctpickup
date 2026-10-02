import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";

import { useChalkStroke } from "@/components/chalk/stroke";
import { PITCH_SPOT_NAME, PITCH_SPOT_XY, PITCH_SPOTS, type PitchSpot } from "@/lib/pitchPosition";
import { themeColor, useThemedStyles } from "@/theme";

const HEIGHT = 140;
const VB_W = 68;
const VB_H = 105;
const WIDTH = Math.round((HEIGHT * VB_W) / VB_H);
const DOT_R = 3.6;

/** Small vertical chalk pitch: the primary spot filled with the accent, the other spots outlined. */
export default function PositionPitch({ spot }: { spot: PitchSpot | null }) {
  useThemedStyles(publish_styles);
  const chalk = useChalkStroke("line", { width: 0.9 });
  const c = themeColor();

  return (
    <View style={styles.row}>
      <Svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`-1 -1 ${VB_W + 2} ${VB_H + 2}`}
        accessible
        accessibilityLabel={spot ? `Plays ${PITCH_SPOT_NAME[spot]}` : "No position set"}
      >
        <Rect x={0} y={0} width={VB_W} height={VB_H} rx={1.5} {...chalk} />
        <Line x1={0} y1={VB_H / 2} x2={VB_W} y2={VB_H / 2} {...chalk} />
        <Circle cx={VB_W / 2} cy={VB_H / 2} r={9.15} {...chalk} />
        <Rect x={(VB_W - 40.3) / 2} y={0} width={40.3} height={16.5} {...chalk} />
        <Rect x={(VB_W - 18.3) / 2} y={0} width={18.3} height={5.5} {...chalk} />
        <Rect x={(VB_W - 40.3) / 2} y={VB_H - 16.5} width={40.3} height={16.5} {...chalk} />
        <Rect x={(VB_W - 18.3) / 2} y={VB_H - 5.5} width={18.3} height={5.5} {...chalk} />
        {PITCH_SPOTS.map((s) => {
          const { x, y } = PITCH_SPOT_XY[s];
          return s === spot ? (
            <Circle key={s} cx={x} cy={y} r={DOT_R + 0.6} fill={c.accent} />
          ) : (
            <Circle key={s} cx={x} cy={y} r={DOT_R} fill="none" stroke={c.muted} strokeWidth={0.9} />
          );
        })}
      </Svg>
      <View style={styles.text}>
        {spot ? (
          <>
            <Text style={styles.code}>{spot}</Text>
            <Text style={styles.name}>{PITCH_SPOT_NAME[spot]}</Text>
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
    text: { flex: 1 },
    code: { color: themeColor().text, fontSize: 20, fontFamily: "Inter_700Bold", fontWeight: "700" },
    name: { marginTop: 2, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
