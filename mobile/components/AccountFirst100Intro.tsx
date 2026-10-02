import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { headline, radius, themeColor, useThemedStyles } from "@/theme";
/** AsyncStorage key — remove this value to show the intro again (or use `clearAccountFirstIntroFlag`). */
export const ACCOUNT_FIRST_INTRO_STORAGE_KEY = "ctpickup_account_100_intro_v1";

export async function clearAccountFirstIntroFlag(): Promise<void> {
  try {
    await appAsyncStorage.removeItem(ACCOUNT_FIRST_INTRO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function loadSeenFlag(): Promise<boolean> {
  try {
    const v = await appAsyncStorage.getItem(ACCOUNT_FIRST_INTRO_STORAGE_KEY);
    return v === "1";
  } catch {
    return true;
  }
}

async function persistSeen(): Promise<void> {
  try {
    await appAsyncStorage.setItem(ACCOUNT_FIRST_INTRO_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** First visit to Account: brief “100 / 100” stat-style reveal, then hides forever (skippable). */
export function AccountFirst100Intro(props?: { trackedPickups?: number; scorePct?: number | null }) {
  useThemedStyles(publish_styles);

  const [checking, setChecking] = useState(true);
  const [visible, setVisible] = useState(false);

  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [leftNum, setLeftNum] = useState(0);

  const scorePct = typeof props?.scorePct === "number" ? props?.scorePct : null;
  const tracked = typeof props?.trackedPickups === "number" ? Math.max(0, Math.floor(props.trackedPickups)) : 0;
  const building = scorePct == null;
  const denom = building ? 3 : 100;
  const target = building ? Math.min(3, tracked) : Math.max(0, Math.min(100, Math.round(scorePct)));

  const finalizedRef = useRef(false);
  const userSkippedRef = useRef(false);
  const progressListenerId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seen = await loadSeenFlag();
      if (cancelled) return;
      setChecking(false);
      if (!seen) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function detachProgressListener() {
    const id = progressListenerId.current;
    if (id === null) return;
    progress.removeListener(id);
    progressListenerId.current = null;
  }

  function finalizeOnce() {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    detachProgressListener();
    progress.stopAnimation();
    scale.stopAnimation();
    opacity.stopAnimation();
    void persistSeen();
    setVisible(false);
  }

  function fadeOutAndClose() {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
      easing: Easing.in(Easing.quad),
    }).start(({ finished }) => {
      if (finished) finalizeOnce();
    });
  }

  useEffect(() => {
    if (!visible || checking) return;
    finalizedRef.current = false;
    userSkippedRef.current = false;

    const id = progress.addListener(({ value }) => {
      setLeftNum(Math.max(0, Math.min(target, Math.round(Number(value) * target))));
    });
    progressListenerId.current = id;

    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.spring(scale, { toValue: 1, friction: 8, tension: 95, useNativeDriver: true }),
      ]),
      Animated.timing(progress, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: false,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.06,
            duration: 110,
            useNativeDriver: true,
            easing: Easing.out(Easing.quad),
          }),
          Animated.spring(scale, { toValue: 1, friction: 7, tension: 140, useNativeDriver: true }),
        ]),
        Animated.delay(460),
      ]),
    ]).start(({ finished }) => {
      detachProgressListener();
      if (userSkippedRef.current || finalizedRef.current) return;
      if (!finished) return;
      setLeftNum(target);
      fadeOutAndClose();
    });

    return () => {
      detachProgressListener();
      progress.stopAnimation();
      scale.stopAnimation();
      opacity.stopAnimation();
    };
  }, [visible, checking, opacity, scale, progress, target]);

  function dismissNow() {
    if (finalizedRef.current) return;
    userSkippedRef.current = true;
    detachProgressListener();
    progress.stopAnimation();
    scale.stopAnimation();
    Animated.timing(opacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
      easing: Easing.in(Easing.quad),
    }).start(({ finished }) => {
      if (finished) finalizeOnce();
    });
  }

  if (!visible || checking) return null;

  return (
    <Pressable accessibilityRole="button" accessibilityHint="Dismisses introduction" style={styles.backdrop} onPress={dismissNow}>
      <Animated.View style={[styles.panel, { opacity, transform: [{ scale }] }]}>
        <Text style={styles.label}>Account</Text>
        <View style={styles.fractionRow}>
          <Text style={styles.numLeft}>{leftNum}</Text>
          <Text style={styles.slash}>/</Text>
          <Text style={styles.numRight}>{denom}</Text>
        </View>
        <Text style={styles.hint}>
          {building
            ? "Pickup rating is still building. After 3 attended sessions, you’ll see your /100 rating."
            : "This is your pickup rating out of 100."}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function make_styles() {
  return StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: themeColor().bg,
    zIndex: 100,
  },
  panel: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 44,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
    minWidth: 272,
  },
  label: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
    marginBottom: 8,
  },
  fractionRow: { flexDirection: "row", alignItems: "baseline" },
  numLeft: { fontSize: 56, ...headline, color: themeColor().pitchText, fontVariant: ["tabular-nums"] },
  slash: {
    fontSize: 56, ...headline,
    color: themeColor().muted,
    marginHorizontal: 4,
    marginBottom: 4,
  },
  numRight: { fontSize: 56, ...headline, color: themeColor().text, fontVariant: ["tabular-nums"] },
  hint: { marginTop: 20, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

