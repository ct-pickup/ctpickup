import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";

import { introColor, SPLASH_LOGO_WIDTH, useThemedStyles } from "@/theme";
import { Wordmark } from "@/components/brand/Wordmark";
import { PRODUCT_NAME } from "@/lib/brand";
export const APP_OPENING_THEME_STORAGE_KEY = "ctpickup_app_opening_theme_v1";

const RING = 108;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- static asset
const LOGO = require("@/assets/brand/ct-logo.png");

async function loadSeen(): Promise<boolean> {
  try {
    const v = await appAsyncStorage.getItem(APP_OPENING_THEME_STORAGE_KEY);
    return v === "1";
  } catch {
    return true;
  }
}

async function persistSeen(): Promise<void> {
  try {
    await appAsyncStorage.setItem(APP_OPENING_THEME_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Clears the “seen” flag so the opening theme can show again on next mount (e.g. dev replay). */
export async function clearAppOpeningThemeFlag(): Promise<void> {
  try {
    await appAsyncStorage.removeItem(APP_OPENING_THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** First cold open only: cyan ripple pulse around the CT logo, then wordmark; auto-dismiss after ~3s. */
export function AppOpeningTheme() {
  useThemedStyles(publish_styles);

  const [gate, setGate] = useState<"check" | "show" | "hide">("check");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seen = await loadSeen();
      if (cancelled) return;
      setGate(seen ? "hide" : "show");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate !== "show") return null;

  return <AppOpeningThemeInner onDone={() => setGate("hide")} />;
}

function AppOpeningThemeInner({ onDone }: { onDone: () => void }) {
  useThemedStyles(publish_styles);

  const ripple1Scale = useSharedValue(0.08);
  const ripple1Opacity = useSharedValue(0);
  const ripple2Scale = useSharedValue(0.08);
  const ripple2Opacity = useSharedValue(0);
  const brandOpacity = useSharedValue(0);
  const shellOpacity = useSharedValue(1);
  const doneRef = useRef(false);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishOnce = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    void (async () => {
      await persistSeen();
      onDone();
    })();
  }, [onDone]);

  /** A tap skips the intro: fade out quickly, then finish. */
  const skip = useCallback(() => {
    if (doneRef.current) return;
    shellOpacity.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
    skipTimerRef.current = setTimeout(finishOnce, 200);
  }, [finishOnce, shellOpacity]);

  useEffect(() => {
    ripple1Opacity.value = withSequence(
      withTiming(0.48, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 1120, easing: Easing.in(Easing.quad) }),
    );
    ripple1Scale.value = withTiming(14, { duration: 1240, easing: Easing.out(Easing.cubic) });

    ripple2Opacity.value = withDelay(
      260,
      withSequence(
        withTiming(0.38, { duration: 160, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 1040, easing: Easing.in(Easing.quad) }),
      ),
    );
    ripple2Scale.value = withDelay(260, withTiming(11, { duration: 1180, easing: Easing.out(Easing.cubic) }));

    brandOpacity.value = withDelay(520, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));

    const fadeTimer = setTimeout(() => {
      shellOpacity.value = withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) });
    }, 2850);
    const finishTimer = setTimeout(finishOnce, 3300);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run entrance animation once per mount
  }, []);

  const r1Style = useAnimatedStyle(() => ({
    opacity: ripple1Opacity.value,
    transform: [{ scale: ripple1Scale.value }],
  }));

  const r2Style = useAnimatedStyle(() => ({
    opacity: ripple2Opacity.value,
    transform: [{ scale: ripple2Scale.value }],
  }));

  const brandStyle = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
  }));

  const shellStyle = useAnimatedStyle(() => ({
    opacity: shellOpacity.value,
  }));

  return (
    <Animated.View style={[styles.shell, shellStyle]} pointerEvents="auto">
      <StatusBar style="light" />
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip intro" />
      <View style={styles.stage} pointerEvents="none">
        <View style={styles.ringLayer} pointerEvents="none">
          <Animated.View style={[styles.ring, r1Style]} />
          <Animated.View style={[styles.ring, r2Style]} />
        </View>
        <Animated.View style={[styles.brand, brandStyle]}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" alt={PRODUCT_NAME} />
          <Wordmark size={24} color={introColor.text} style={styles.wordmark} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function make_styles() {
  return StyleSheet.create({
  shell: {
    ...StyleSheet.absoluteFill,
    zIndex: 100000,
    backgroundColor: introColor.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  stage: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight: 280,
  },
  ringLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  ring: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    borderColor: introColor.ring,
    backgroundColor: "transparent",
  },
  // The logo is the only in-flow child so it stays at the exact screen center, like the native splash.
  brand: {
    alignItems: "center",
    zIndex: 2,
  },
  logo: { width: SPLASH_LOGO_WIDTH, height: SPLASH_LOGO_WIDTH },
  wordmark: {
    position: "absolute",
    top: SPLASH_LOGO_WIDTH + 16,
    alignSelf: "center",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

