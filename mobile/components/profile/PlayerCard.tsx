import FontAwesome from "@expo/vector-icons/FontAwesome";
import { forwardRef, useEffect, type ReactNode } from "react";
import { ActivityIndicator, Image, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";

import PlayerAvatar from "@/components/PlayerAvatar";
import { GrainOverlay } from "@/components/photo";
import { StarRating } from "@/components/StarRating";
import { BRAND_NAME } from "@/lib/brand";
import { STORY_HEIGHT, STORY_WIDTH } from "@/lib/shareStory";
import { headline, playerCardColor as C, radius } from "@/theme";

export type PlayerCardData = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  /** "CB · Westport" */
  positionTown: string | null;
  star: number | null;
  /** player_cards.star_provisional: shown as the "New" chip. */
  provisional: boolean;
  verified: boolean;
  games: number;
  winPct: number | null;
  potd: number;
  /** Action photo (action-photos bucket); the card is plain ink without one. */
  photo: string | null;
};

type ScreenProps = {
  data: PlayerCardData;
  variant?: "screen";
  onPressAvatar?: () => void;
  onPressRating?: () => void;
  avatarBusy?: boolean;
  /** Shown on the avatar while editing. */
  avatarBadge?: ReactNode;
};

type ShareProps = {
  data: PlayerCardData;
  variant: "share";
  /** Fires once the background photo has loaded (or at once without one). */
  onReady?: () => void;
};

const AVATAR_SIZE = 96;
/** Card width inside the 360-wide share frame; the frame scales it up to the story size. */
const SHARE_CARD_WIDTH = 328;

/**
 * The Profile player card. `variant="share"` renders the same card centered on a 9:16 ink frame with the
 * wordmark, for the "Share my card" image. Public facts only: never score, tier or reliability.
 */
const PlayerCard = forwardRef<View, ScreenProps | ShareProps>(function PlayerCard(props, ref) {
  if (props.variant === "share") return <ShareFrame ref={ref} data={props.data} onReady={props.onReady} />;
  return (
    <CardBody
      data={props.data}
      onPressAvatar={props.onPressAvatar}
      onPressRating={props.onPressRating}
      avatarBusy={props.avatarBusy}
      avatarBadge={props.avatarBadge}
    />
  );
});

export default PlayerCard;

const ShareFrame = forwardRef<View, { data: PlayerCardData; onReady?: () => void }>(function ShareFrame({ data, onReady }, ref) {
  const width = STORY_WIDTH / PixelRatio.get();
  const height = STORY_HEIGHT / PixelRatio.get();
  const u = width / 360;

  useEffect(() => {
    if (!data.photo) onReady?.();
  }, [data.photo, onReady]);

  return (
    <View ref={ref} collapsable={false} style={[styles.frame, { width, height }]}>
      <GrainOverlay />
      <View style={[StyleSheet.absoluteFill, styles.frameCenter]}>
        <View style={{ width: SHARE_CARD_WIDTH, transform: [{ scale: u }] }}>
          <CardBody data={data} onPhotoLoad={onReady} />
        </View>
      </View>
      <View style={[styles.wordmarkRow, { bottom: Math.round(96 * u) }]}>
        <View style={[styles.brandDot, { width: 10 * u, height: 10 * u, borderRadius: 5 * u, marginRight: 8 * u }]} />
        <Text allowFontScaling={false} style={[styles.wordmark, { fontSize: 20 * u }]}>
          {BRAND_NAME}
        </Text>
      </View>
    </View>
  );
});

function CardBody({
  data,
  onPressAvatar,
  onPressRating,
  avatarBusy,
  avatarBadge,
  onPhotoLoad,
}: {
  data: PlayerCardData;
  onPressAvatar?: () => void;
  onPressRating?: () => void;
  avatarBusy?: boolean;
  avatarBadge?: ReactNode;
  onPhotoLoad?: () => void;
}) {
  const avatar = (
    <>
      <PlayerAvatar
        person={{ first_name: data.firstName, last_name: data.lastName, avatar_url: data.avatarUrl }}
        size={AVATAR_SIZE}
      />
      {avatarBusy ? (
        <View style={[StyleSheet.absoluteFill, styles.avatarBusy]}>
          <ActivityIndicator color={C.name} />
        </View>
      ) : null}
      {avatarBadge}
    </>
  );

  const rating =
    data.star != null ? (
      <StarRating value={data.star} size="md" tone="onPhoto" showLevel />
    ) : null;

  return (
    <View style={styles.card}>
      {data.photo ? (
        <>
          <Image source={{ uri: data.photo }} alt="" style={StyleSheet.absoluteFill} resizeMode="cover" onLoadEnd={onPhotoLoad} />
          <View style={[StyleSheet.absoluteFill, styles.photoScrim]} />
        </>
      ) : null}
      <GrainOverlay />
      {data.verified ? <View style={styles.stripe} /> : null}

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
          <Text allowFontScaling={false} style={styles.name} numberOfLines={2}>
            {data.name}
          </Text>
          {data.positionTown ? (
            <Text allowFontScaling={false} style={styles.meta} numberOfLines={1}>
              {data.positionTown}
            </Text>
          ) : null}
          {rating && onPressRating ? (
            <Pressable
              onPress={onPressRating}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityHint="Shows what each star level means"
              style={({ pressed }) => [styles.rating, pressed && styles.pressed]}
            >
              {rating}
            </Pressable>
          ) : rating ? (
            <View style={styles.rating}>{rating}</View>
          ) : null}
          {data.provisional || data.verified ? (
            <View style={styles.chips}>
              {data.provisional ? (
                <View style={[styles.chip, styles.chipNew]}>
                  <Text allowFontScaling={false} style={styles.chipNewText}>
                    New
                  </Text>
                </View>
              ) : null}
              {data.verified ? (
                <View style={[styles.chip, styles.chipVerified]}>
                  <FontAwesome name="check" size={10} color={C.chipText} />
                  <Text allowFontScaling={false} style={styles.chipVerifiedText}>
                    Verified
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

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

const styles = StyleSheet.create({
  frame: { backgroundColor: C.bg, overflow: "hidden" },
  frameCenter: { alignItems: "center", justifyContent: "center", paddingBottom: 48 },
  wordmarkRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  brandDot: { backgroundColor: C.accent },
  wordmark: { fontFamily: headline.fontFamily, color: C.name },

  card: { borderRadius: radius.playerCard, backgroundColor: C.bg, overflow: "hidden", padding: 16, paddingLeft: 19 },
  photoScrim: { backgroundColor: C.photoScrim },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: C.accent },
  top: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarBusy: {
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: C.photoScrim,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: { flex: 1, minWidth: 0 },
  name: { fontFamily: headline.fontFamily, fontSize: 26, lineHeight: 30, color: C.name },
  meta: { marginTop: 2, color: C.muted, fontSize: 14, fontFamily: "Inter_500Medium", fontWeight: "500" },
  rating: { marginTop: 8, alignSelf: "flex-start" },
  pressed: { opacity: 0.7 },
  chips: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  chipNew: { borderWidth: 1, borderColor: C.chipLine },
  chipNewText: { color: C.muted, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  chipVerified: { backgroundColor: C.chipBg },
  chipVerifiedText: { color: C.chipText, fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: C.rule, marginTop: 16, marginBottom: 12 },
  stats: { flexDirection: "row" },
  stat: { flex: 1 },
  statValue: { fontFamily: headline.fontFamily, fontSize: 22, lineHeight: 26, color: C.name },
  statLabel: { marginTop: 2, color: C.muted, fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});
