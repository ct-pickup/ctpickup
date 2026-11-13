import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfettiBurst } from "@/components/ConfettiBurst";
import { SheetModal } from "@/components/motion/SheetModal";
import { useReduceMotion } from "@/hooks/useReduceMotion";

import type { ProfileBadge } from "@/lib/playerBadges";
import { headline, themeColor, useThemedStyles } from "@/theme";
import type { BadgeId } from "@shared/badges";

type IconName = ComponentProps<typeof FontAwesome>["name"];

/** Game milestones show their number; the rest an icon. */
const GLYPH: Record<BadgeId, { icon: IconName } | { numeral: string }> = {
  first_game: { icon: "futbol-o" },
  games_10: { numeral: "10" },
  games_25: { numeral: "25" },
  games_50: { numeral: "50" },
  win_streak_3: { icon: "fire" },
  potd: { icon: "trophy" },
  verified: { icon: "check" },
  hosted: { icon: "flag" },
  referral: { icon: "user-plus" },
};

const UNEARNED_OPACITY = 0.3;

function BadgeGlyph({ id, size, locked = false }: { id: BadgeId; size: number; locked?: boolean }) {
  const g = GLYPH[id];
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.glyph, box, locked && styles.glyphLocked]}>
      {"icon" in g ? (
        <FontAwesome name={g.icon} size={Math.round(size * 0.4)} color={locked ? themeColor().muted : themeColor().onPitchPanel} />
      ) : (
        <Text style={[styles.numeral, locked && styles.numeralLocked, { fontSize: Math.round(size * 0.34) }]}>{g.numeral}</Text>
      )}
    </View>
  );
}

/**
 * A badge that was just earned: pops in (scale), glows, and throws a short confetti burst. Plays once per mount of the celebration.
 * Under Reduce Motion the badge simply shows as earned.
 */
function UnlockingBadge({ children, order }: { children: React.ReactNode; order: number }) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const delay = 150 + order * 350;
  const scale = useDerivedValue(
    () =>
      reduceMotion
        ? 1
        : withSequence(
            withTiming(0.6, { duration: 0 }),
            withDelay(delay, withSequence(withTiming(1.25, { duration: 260, easing: Easing.out(Easing.back(2)) }), withTiming(1, { duration: 220 }))),
          ),
    [reduceMotion, delay],
  );
  const glow = useDerivedValue(
    () => (reduceMotion ? 0 : withSequence(withTiming(0, { duration: 0 }), withDelay(delay, withSequence(withTiming(1, { duration: 300 }), withDelay(500, withTiming(0, { duration: 600 })))))),
    [reduceMotion, delay],
  );
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 1 + glow.value * 0.6 }] }));
  return (
    <View style={styles.unlockWrap}>
      <Animated.View pointerEvents="none" style={[styles.halo, halo]} />
      {!reduceMotion ? <ConfettiBurst playKey={order} delayMs={delay} /> : null}
      <Animated.View style={pop}>{children}</Animated.View>
    </View>
  );
}

/**
 * Wrapping badge grid, every badge visible. Unearned badges are greyed; tapping any badge explains how to earn it.
 * `justEarned` are the badges to celebrate on this render (the caller works them out from the device's memory).
 */
export default function BadgeShelf({ badges, justEarned }: { badges: ProfileBadge[]; justEarned?: ReadonlyArray<BadgeId> }) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<ProfileBadge | null>(null);
  const celebrating = useMemo(() => new Set(justEarned ?? []), [justEarned]);

  // Earned first, each group keeping the order BADGES declares.
  const ordered = useMemo(
    () => [...badges].sort((a, b) => Number(b.earned) - Number(a.earned)),
    [badges],
  );

  return (
    <>
      <View style={styles.grid}>
        {ordered.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => setOpen(b)}
            style={({ pressed }) => [styles.badge, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${b.label}, ${b.earned ? "earned" : "not earned yet"}`}
          >
            {celebrating.has(b.id) ? (
              <UnlockingBadge order={[...celebrating].indexOf(b.id)}>
                <BadgeGlyph id={b.id} size={36} locked={false} />
              </UnlockingBadge>
            ) : (
              <BadgeGlyph id={b.id} size={36} locked={!b.earned} />
            )}
            <Text style={[styles.label, !b.earned && styles.labelLocked]} numberOfLines={2}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <SheetModal visible={open != null} onClose={() => setOpen(null)}>
          {open ? (
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              <View style={styles.handle} />
              <View style={[styles.sheetGlyph, !open.earned && styles.unearned]}>
                <BadgeGlyph id={open.id} size={72} />
              </View>
              <Text style={styles.title}>{open.label}</Text>
              <Text style={styles.status}>{open.earned ? "Earned" : "Not earned yet"}</Text>
              <Text style={styles.how}>{open.howToEarn}</Text>
              <Pressable
                onPress={() => setOpen(null)}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.closeText}>Got it</Text>
              </Pressable>
            </View>
          ) : null}
      </SheetModal>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, rowGap: 6 },
    badge: { width: "20%", alignItems: "center", paddingHorizontal: 2 },
    unearned: { opacity: UNEARNED_OPACITY },
    glyphLocked: { backgroundColor: themeColor().overlayStrong },
    numeralLocked: { color: themeColor().muted },
    labelLocked: { color: themeColor().muted },
    pressed: { opacity: 0.7 },
    glyph: { backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
    unlockWrap: { alignItems: "center", justifyContent: "center" },
    halo: { position: "absolute", width: 36, height: 36, borderRadius: 18, backgroundColor: themeColor().pitch },
    numeral: { fontFamily: headline.fontFamily, color: themeColor().onPitchPanel },
    label: {
      marginTop: 3,
      textAlign: "center",
      color: themeColor().text,
      fontSize: 10.5,
      lineHeight: 13,
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
    },
    root: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
    sheet: {
      backgroundColor: themeColor().bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: themeColor().overlay,
      paddingHorizontal: 20,
      paddingTop: 8,
      alignItems: "center",
    },
    handle: { width: 40, height: 4, borderRadius: 10, backgroundColor: themeColor().overlay, marginBottom: 16 },
    sheetGlyph: { marginBottom: 12 },
    title: { color: themeColor().text, fontSize: 20, fontFamily: headline.fontFamily },
    status: { marginTop: 4, color: themeColor().muted, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    how: {
      marginTop: 12,
      textAlign: "center",
      color: themeColor().text,
      fontSize: 15,
      lineHeight: 21,
      fontFamily: "Inter_400Regular",
    },
    close: {
      marginTop: 20,
      alignSelf: "stretch",
      paddingVertical: 14,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: themeColor().pitchText,
      alignItems: "center",
    },
    closeText: { color: themeColor().pitchText, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
