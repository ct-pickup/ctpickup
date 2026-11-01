import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, Text, View } from "react-native";

import { ReliabilityRing, SettleProgress } from "@/components/profile/RatingReliability";
import { StarRating } from "@/components/StarRating";
import type { RatingDisplay } from "@/lib/ratingDisplayCore";
import { ratingNumeral, themeColor, useThemedStyles } from "@/theme";

type Props = {
  star: number;
  provisional: boolean;
  verified?: boolean;
  /** Level name under the stars ("College"), if any. */
  level?: string | null;
  /** From ratingDisplay(); gamesLabel must be set. The ring appears only when reliability is set. */
  display: RatingDisplay;
  /** Exact rating, so the stars fill continuously. */
  exact?: number | null;
  /**
   * Small version for "Your season": the exact number, the stars and, if it applies, the Provisional label. Nothing else
   * (no ring, bar, level or Verified chip). `provisional` then only controls that label; the stars are never dimmed.
   */
  compact?: boolean;
};

/**
 * Profile rating block for the dark card: exact two decimal rating, reliability ring, half star row, "X stars",
 * Provisional to Settled bar with games so far. The stars show the exact value, so there is no rounding note. Only used when the games behind the rating are known.
 */
export function RatingBlock({ star, provisional, verified, level, display, exact, compact }: Props) {
  useThemedStyles(publish_styles);
  const c = themeColor();
  if (compact) {
    return (
      <View style={styles.compactRow}>
        <Text allowFontScaling={false} style={styles.compactNumber} accessibilityLabel={`${display.number} rating`}>
          {display.number}
        </Text>
        <View style={styles.compactSide}>
          <StarRating value={star} exact={exact} px={18} showValue={false} showLevel={false} tone="onPhoto" />
          {provisional ? (
            <Text allowFontScaling={false} style={styles.small}>
              Provisional
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <View style={styles.numberRow}>
        <Text allowFontScaling={false} style={styles.exactNumber} accessibilityLabel={`${display.number} rating`}>
          {display.number}
        </Text>
        {display.reliability != null ? <ReliabilityRing percent={display.reliability} /> : null}
      </View>
      <View style={styles.starsRow}>
        <StarRating value={star} exact={exact} provisional={provisional} px={20} showValue={false} showLevel={false} tone="onPhoto" />
        <Text allowFontScaling={false} style={styles.stars}>
          {display.starsText}
        </Text>
        {verified ? (
          <View style={styles.verified}>
            <FontAwesome name="check" size={10} color={c.onInk} />
            <Text allowFontScaling={false} style={styles.small}>Verified</Text>
          </View>
        ) : null}
      </View>
      {level ? (
        <Text allowFontScaling={false} style={styles.small} numberOfLines={1}>
          {level}
        </Text>
      ) : null}
      {display.progress != null && display.gamesLabel ? <SettleProgress progress={display.progress} gamesLabel={display.gamesLabel} /> : null}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    block: { gap: 6, alignSelf: "stretch" },
    compactRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    compactNumber: { ...ratingNumeral(40), color: c.pitch },
    compactSide: { gap: 4 },
    numberRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    exactNumber: { ...ratingNumeral(68), color: c.pitch },
    starsRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    stars: { color: c.onInk, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    small: { color: c.onInk, opacity: 0.8, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    verified: { flexDirection: "row", alignItems: "center", gap: 3 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
