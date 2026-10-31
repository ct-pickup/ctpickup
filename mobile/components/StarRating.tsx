import { useId } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";

import { starFills, starNumberText } from "@/lib/starFillCore";
import { shareCardColor, themeColor, useThemedStyles } from "@/theme";
import { starLevelName } from "@shared/starLevels";

export type StarRatingSize = "sm" | "md" | "lg";

type Props = {
  value: number | null | undefined;
  /**
   * Exact rating (player_cards.rating_exact). When it rounds to `value`, the stars fill continuously and the number beside
   * them shows two decimals. Leave it out (share images, rows without it) and the stars are half stars as before.
   */
  exact?: number | null;
  provisional?: boolean;
  size?: StarRatingSize;
  showValue?: boolean;
  /** Level name after the number ("4.0 College"). Defaults on for md and lg. */
  showLevel?: boolean;
  /** Fixed light-on-dark colors for photos and the share card. */
  tone?: "theme" | "onPhoto";
  /** Exact star size in points; overrides `size` for rendered images. */
  px?: number;
  /** Fill colors for the premium share cards; the free card and the app leave these unset. */
  color?: string;
  offColor?: string;
  style?: StyleProp<ViewStyle>;
};

const STAR_PX: Record<StarRatingSize, number> = { sm: 12, md: 16, lg: 26 };
const GAP_PX: Record<StarRatingSize, number> = { sm: 1, md: 2, lg: 3 };

/** Five-point star on a 24×24 box with each tip replaced by a short quadratic curve. */
function roundedStarPath(): string {
  const cx = 12;
  const cy = 12.6;
  const outer = 11.4;
  const inner = 4.9;
  const pts: Array<{ x: number; y: number; tip: boolean }> = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), tip: i % 2 === 0 });
  }
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const f = (n: number) => n.toFixed(3);
  let d = "";
  pts.forEach((v, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const t = v.tip ? 0.16 : 0.08;
    const a = lerp(v, prev, t);
    const b = lerp(v, next, t);
    d += `${i === 0 ? "M" : "L"}${f(a.x)},${f(a.y)} Q${f(v.x)},${f(v.y)} ${f(b.x)},${f(b.y)} `;
  });
  return `${d}Z`;
}

const STAR_PATH = roundedStarPath();
/** Left edge and width of the drawn star inside its 24 box, so a fill of 0.35 covers 35 percent of the star itself, not of the box. */
const STAR_LEFT = 1.16;
const STAR_SPAN = 21.68;

export function StarGlyph({
  fill,
  px,
  clipId,
  tone,
  color,
  offColor,
}: {
  /** 0 to 1 of the star's width, filled from the left. */
  fill: number;
  px: number;
  clipId: string;
  tone: "theme" | "onPhoto";
  color?: string;
  offColor?: string;
}) {
  const on = color ?? (tone === "onPhoto" ? shareCardColor.accent : themeColor().accent);
  const off = offColor ?? (tone === "onPhoto" ? shareCardColor.starOff : themeColor().line);
  const partial = fill > 0 && fill < 1;
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24">
      {partial ? (
        <Defs>
          <ClipPath id={clipId}>
            <Rect x="0" y="0" width={STAR_LEFT + STAR_SPAN * fill} height="24" />
          </ClipPath>
        </Defs>
      ) : null}
      <Path d={STAR_PATH} fill={fill >= 1 ? on : off} />
      {partial ? <Path d={STAR_PATH} fill={on} clipPath={`url(#${clipId})`} /> : null}
    </Svg>
  );
}

export function StarRating({
  value,
  exact,
  provisional = false,
  size = "md",
  showValue = true,
  showLevel,
  tone = "theme",
  px: pxOverride,
  color,
  offColor,
  style,
}: Props) {
  useThemedStyles(publish_styles);
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (value == null || !Number.isFinite(value)) return null;

  const clamped = Math.min(5, Math.max(0, value));
  const fills = starFills(clamped, exact);
  const numberText = starNumberText(clamped, exact);
  const px = pxOverride ?? STAR_PX[size];
  const gap = pxOverride ? Math.max(1, Math.round(pxOverride * 0.12)) : GAP_PX[size];
  const onPhoto = tone === "onPhoto";
  const customText = pxOverride
    ? { fontSize: Math.round(pxOverride * 0.78), marginLeft: Math.round(pxOverride * 0.35) }
    : null;
  const levelName = (showLevel ?? (pxOverride == null && size !== "sm")) ? starLevelName(clamped) : null;
  const label = `${numberText} stars${levelName ? `, ${levelName}` : ""}${provisional ? ", new player" : ""}`;

  return (
    <View style={[styles.row, style]} accessible accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.row, { gap }, provisional && styles.provisional]}>
        {[0, 1, 2, 3, 4].map((i) => {
          return <StarGlyph key={i} fill={fills[i] ?? 0} px={px} clipId={`star-half-${baseId}-${i}`} tone={tone} color={color} offColor={offColor} />;
        })}
        {showValue ? (
          <Text style={[styles.value, styles[`value_${size}`], customText, onPhoto && styles.valueOnPhoto]}>
            {numberText}
          </Text>
        ) : null}
        {levelName ? (
          <Text style={[styles.level, styles[`value_${size}`], customText, onPhoto && styles.valueOnPhoto]}>{levelName}</Text>
        ) : null}
      </View>
      {provisional ? (
        <Text style={[styles.newLabel, styles[`new_${size}`], onPhoto && styles.newOnPhoto]}>New</Text>
      ) : null}
    </View>
  );
}

export default StarRating;

function make_styles() {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center" },
    provisional: { opacity: 0.5 },
    value: { color: themeColor().text, fontFamily: "Inter_700Bold", fontWeight: "700", marginLeft: 4 },
    level: { color: themeColor().text, fontFamily: "Inter_600SemiBold", fontWeight: "600", marginLeft: 6 },
    valueOnPhoto: { color: shareCardColor.text },
    newOnPhoto: { color: shareCardColor.muted, borderColor: shareCardColor.faint },
    value_sm: { fontSize: 12 },
    value_md: { fontSize: 14 },
    value_lg: { fontSize: 20, marginLeft: 8 },
    newLabel: {
      color: themeColor().muted,
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      marginLeft: 6,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: 999,
      paddingHorizontal: 6,
      overflow: "hidden",
    },
    new_sm: { fontSize: 10 },
    new_md: { fontSize: 11 },
    new_lg: { fontSize: 13, paddingVertical: 1 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
