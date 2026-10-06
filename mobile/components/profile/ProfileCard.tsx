import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import PlayerAvatar from "@/components/PlayerAvatar";
import { StarRating } from "@/components/StarRating";
import type { PlayerCardData } from "@/components/profile/PlayerCard";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { starLevelName } from "@shared/starLevels";

const AVATAR_SIZE = 56;

type Props = {
  data: PlayerCardData;
  onPressAvatar?: () => void;
  onPressRating?: () => void;
  avatarBusy?: boolean;
  /** Shown on the avatar while editing. */
  avatarBadge?: ReactNode;
  /** Share icon in the top right; omitted when sharing is unavailable. */
  onShare?: () => void;
  shareBusy?: boolean;
  shareDisabled?: boolean;
};

/**
 * Compact pitch-green Profile card: photo, name and position, the rating and level,
 * and the Games / Win % / POTD row. The ink PlayerCard is still what the share image renders.
 */
export default function ProfileCard({
  data,
  onPressAvatar,
  onPressRating,
  avatarBusy,
  avatarBadge,
  onShare,
  shareBusy,
  shareDisabled,
}: Props) {
  useThemedStyles(publish_styles);
  const c = themeColor();
  const level = starLevelName(data.star);

  const avatar = (
    <>
      <PlayerAvatar
        person={{ first_name: data.firstName, last_name: data.lastName, avatar_url: data.avatarUrl }}
        size={AVATAR_SIZE}
      />
      {avatarBusy ? (
        <View style={[StyleSheet.absoluteFill, styles.avatarBusy]}>
          <ActivityIndicator color={c.onInk} />
        </View>
      ) : null}
      {avatarBadge}
    </>
  );

  const rating =
    data.star != null ? (
      <View style={styles.ratingRow}>
        <Text allowFontScaling={false} style={styles.bigNumber}>
          {data.star.toFixed(1)}
        </Text>
        <View style={styles.ratingSide}>
          <StarRating value={data.star} provisional={data.provisional} px={20} showValue={false} showLevel={false} tone="onPhoto" />
          <View style={styles.levelRow}>
            {level ? (
              <Text allowFontScaling={false} style={styles.level} numberOfLines={1}>
                {level}
              </Text>
            ) : null}
            {data.provisional ? <Text allowFontScaling={false} style={styles.chip}>New</Text> : null}
            {data.verified ? (
              <View style={styles.verified}>
                <FontAwesome name="check" size={10} color={c.onInk} />
                <Text allowFontScaling={false} style={styles.chip}>Verified</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    ) : null;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {onPressAvatar ? (
          <Pressable
            onPress={onPressAvatar}
            disabled={avatarBusy}
            style={styles.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            {avatar}
          </Pressable>
        ) : (
          <View style={styles.avatarWrap}>{avatar}</View>
        )}
        <View style={styles.identity}>
          <Text allowFontScaling={false} style={styles.name} numberOfLines={1}>
            {data.name}
          </Text>
          {data.positionTown ? (
            <Text allowFontScaling={false} style={styles.meta} numberOfLines={1}>
              {data.positionTown}
            </Text>
          ) : null}
        </View>
        {onShare ? (
          <Pressable
            onPress={onShare}
            disabled={shareDisabled || shareBusy}
            hitSlop={10}
            style={({ pressed }) => [styles.shareBtn, (pressed || shareDisabled || shareBusy) && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Share my player card"
          >
            {shareBusy ? (
              <ActivityIndicator size="small" color={c.onInk} />
            ) : (
              <FontAwesome name="share-square-o" size={16} color={c.onInk} />
            )}
          </Pressable>
        ) : null}
      </View>

      {rating && onPressRating ? (
        <Pressable
          onPress={onPressRating}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityHint="Shows what each star level means"
          style={({ pressed }) => [styles.ratingWrap, pressed && styles.pressed]}
        >
          {rating}
        </Pressable>
      ) : rating ? (
        <View style={styles.ratingWrap}>{rating}</View>
      ) : null}

      <View style={styles.rule} />
      <View style={styles.stats}>
        <Stat value={String(data.games)} label="Games" />
        <Stat value={data.winPct == null ? "—" : `${data.winPct}%`} label="Win %" />
        <Stat value={String(data.potd)} label="POTD" />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text allowFontScaling={false} style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text allowFontScaling={false} style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    card: { borderRadius: radius.playerCard, backgroundColor: c.inkSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, padding: 14 },
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    avatarBusy: {
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: c.photoScrim,
      alignItems: "center",
      justifyContent: "center",
    },
    identity: { flex: 1, minWidth: 0 },
    name: { fontFamily: headline.fontFamily, fontSize: 22, lineHeight: 26, color: c.onInk },
    meta: { marginTop: 1, color: c.onInk, opacity: 0.8, fontSize: 13, fontFamily: "Inter_500Medium", fontWeight: "500" },
    shareBtn: {
      alignSelf: "flex-start",
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.overlay,
    },
    pressed: { opacity: 0.6 },
    ratingWrap: { marginTop: 10, alignSelf: "flex-start" },
    ratingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    bigNumber: { fontFamily: headline.fontFamily, fontSize: 44, lineHeight: 48, color: c.pitch },
    ratingSide: { gap: 3 },
    levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    level: { color: c.onInk, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    chip: { color: c.onInk, opacity: 0.8, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    verified: { flexDirection: "row", alignItems: "center", gap: 3 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.onInk, opacity: 0.35, marginTop: 10, marginBottom: 8 },
    stats: { flexDirection: "row" },
    stat: { flex: 1 },
    statValue: { fontFamily: headline.fontFamily, fontSize: 18, lineHeight: 22, color: c.onInk },
    statLabel: { color: c.onInk, opacity: 0.8, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
