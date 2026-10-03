import { forwardRef, useEffect } from "react";
import { Image, PixelRatio, StyleSheet, Text, View } from "react-native";

import PlayerAvatar from "@/components/PlayerAvatar";
import { StarRating } from "@/components/StarRating";
import { Wordmark } from "@/components/brand/Wordmark";
import { GrainOverlay } from "@/components/photo";
import type { PlayerCardData } from "@/components/profile/PlayerCard";
import { CARD_SIZES, type CardDesignId, type CardSizeId } from "@/lib/cardDesigns";
import { TAGLINE } from "@/lib/brand";
import { headline } from "@/theme";
import { palette } from "@theme/tokens";
import { starLevelName } from "@shared/starLevels";

type Premium = Exclude<CardDesignId, "classic">;

/** Palette per design, from the shared tokens only. */
const LOOK: Record<Premium, { bg: string; text: string; muted: string; accent: string; off: string; scrim: number; frame: boolean }> = {
  dark: { bg: palette.ink, text: palette.chalk, muted: palette.mutedDark, accent: palette.pitchBright, off: palette.lineDark, scrim: 0.72, frame: false },
  gold: { bg: palette.ink, text: palette.chalk, muted: palette.mutedDark, accent: palette.gold, off: palette.lineDark, scrim: 0.78, frame: true },
  club: { bg: palette.pitch, text: palette.chalk, muted: palette.pitchSoft, accent: palette.chalk, off: palette.onPitchPanelDark, scrim: 0.82, frame: false },
};

type Props = {
  design: Premium;
  size: CardSizeId;
  data: PlayerCardData;
  /** On-screen width in points. Omit to render at exactly the export pixel size (1080 / pixel ratio) for capture. */
  width?: number;
  /** Fires once the action photo has loaded (or at once without one). */
  onReady?: () => void;
};

/**
 * CT+ share card in `design` at 1080x1920 ("story") or 1080x1080 ("square"). Layout is written in export
 * pixels and scaled by `u`, so the preview and the capture are the same picture.
 */
const PremiumShareCard = forwardRef<View, Props>(function PremiumShareCard({ design, size, data, width, onReady }, ref) {
  const spec = CARD_SIZES[size];
  const look = LOOK[design];
  const w = width ?? spec.width / PixelRatio.get();
  const u = w / spec.width;
  const h = spec.height * u;
  const story = size === "story";
  const level = starLevelName(data.star);

  useEffect(() => {
    if (!data.photo) onReady?.();
  }, [data.photo, onReady]);

  const n = (px: number) => px * u;
  return (
    <View ref={ref} collapsable={false} style={{ width: w, height: h, backgroundColor: look.bg, overflow: "hidden" }}>
      {data.photo ? (
        <>
          <Image source={{ uri: data.photo }} alt="" style={StyleSheet.absoluteFill} resizeMode="cover" onLoadEnd={onReady} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: look.bg, opacity: look.scrim }]} />
        </>
      ) : null}
      <GrainOverlay />
      {look.frame ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: n(36), right: n(36), top: n(36), bottom: n(36), borderWidth: n(4), borderColor: look.accent, borderRadius: n(36) }}
        />
      ) : null}

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: n(96), paddingBottom: story ? n(120) : 0 }}>
        <PlayerAvatar
          person={{ first_name: data.firstName, last_name: data.lastName, avatar_url: data.avatarUrl }}
          size={n(story ? 240 : 150)}
          ringColor={look.accent}
        />
        <Text
          allowFontScaling={false}
          numberOfLines={2}
          style={{ marginTop: n(story ? 48 : 24), textAlign: "center", fontFamily: headline.fontFamily, fontSize: n(story ? 104 : 72), lineHeight: n(story ? 112 : 78), color: look.text }}
        >
          {data.name}
        </Text>
        {data.positionTown ? (
          <Text allowFontScaling={false} numberOfLines={1} style={{ marginTop: n(8), fontFamily: "Inter_500Medium", fontSize: n(story ? 44 : 32), color: look.muted }}>
            {data.positionTown}
          </Text>
        ) : null}

        {data.star != null ? (
          <View style={{ marginTop: n(story ? 72 : 32), alignItems: "center" }}>
            <Text allowFontScaling={false} style={{ fontFamily: headline.fontFamily, fontSize: n(story ? 220 : 130), lineHeight: n(story ? 230 : 136), color: look.accent }}>
              {data.star.toFixed(1)}
            </Text>
            <StarRating
              value={data.star}
              px={n(story ? 72 : 44)}
              showValue={false}
              showLevel={false}
              tone="onPhoto"
              color={look.accent}
              offColor={look.off}
              style={{ marginTop: n(12) }}
            />
            {level ? (
              <Text allowFontScaling={false} style={{ marginTop: n(16), fontFamily: "Inter_600SemiBold", fontSize: n(story ? 52 : 36), color: look.text }}>
                {level}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ marginTop: n(story ? 80 : 36), flexDirection: "row", alignSelf: "stretch", borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: look.muted, paddingTop: n(story ? 40 : 22) }}>
          <Stat n={n} story={story} value={String(data.games)} label="Games" color={look.text} muted={look.muted} />
          <Stat n={n} story={story} value={data.winPct == null ? "—" : `${data.winPct}%`} label="Win %" color={look.text} muted={look.muted} />
          <Stat n={n} story={story} value={String(data.potd)} label="POTD" color={look.text} muted={look.muted} />
        </View>
      </View>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: n(story ? 150 : 48), alignItems: "center" }}>
        <Wordmark size={n(story ? 40 : 30)} color={look.text} allowFontScaling={false} />
        {story ? (
          <Text allowFontScaling={false} style={{ marginTop: n(8), fontFamily: "Inter_600SemiBold", fontSize: n(28), color: look.muted }}>
            {TAGLINE}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

export default PremiumShareCard;

function Stat({ n, story, value, label, color, muted }: { n: (px: number) => number; story: boolean; value: string; label: string; color: string; muted: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: headline.fontFamily, fontSize: n(story ? 80 : 56), lineHeight: n(story ? 88 : 62), color }}>
        {value}
      </Text>
      <Text allowFontScaling={false} style={{ fontFamily: "Inter_600SemiBold", fontSize: n(story ? 32 : 24), color: muted }}>
        {label}
      </Text>
    </View>
  );
}
