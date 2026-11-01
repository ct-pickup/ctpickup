import { useAuth } from "@/context/AuthContext";
import { appAsyncStorage } from "@/lib/appAsyncStorage";
import {
  GENDER_NOTICE_OK,
  GENDER_NOTICE_SETTINGS,
  GENDER_NOTICE_TITLE,
  genderNoticeBody,
  markGenderNoticeSeen,
  shouldShowGenderNotice,
} from "@/lib/genderNoticeCore";
import { readOwnGenderResult } from "@/lib/ownGender";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { headline, radius, themeColor, useThemedStyles } from "@/theme";

/** One-time notice about the Gender filter, shown the first time a signed-in player opens the app on this version. Remembered on this device. */
export function GenderNotice() {
  useThemedStyles(publish_styles);

  const { supabase, session, isReady } = useAuth();
  const userId = session?.user?.id ?? null;
  const [shown, setShown] = useState<{ userId: string; body: string } | null>(null);
  const checkedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady || !supabase || !userId || checkedForRef.current === userId) return;
    checkedForRef.current = userId;
    void (async () => {
      if (!(await shouldShowGenderNotice(appAsyncStorage, userId))) return;
      const own = await readOwnGenderResult(supabase);
      setShown({ userId, body: genderNoticeBody(own.value, own.failed) });
    })();
  }, [isReady, supabase, userId]);

  const dismiss = useCallback(
    (openSettings: boolean) => {
      const id = shown?.userId;
      setShown(null);
      if (id) void markGenderNoticeSeen(appAsyncStorage, id);
      if (openSettings) router.push("/settings");
    },
    [shown],
  );

  if (!shown || shown.userId !== userId) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>{GENDER_NOTICE_TITLE}</Text>
        <Text style={styles.body}>{shown.body}</Text>
        <View style={styles.actions}>
          <Pressable onPress={() => dismiss(true)} accessibilityRole="button" style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{GENDER_NOTICE_SETTINGS}</Text>
          </Pressable>
          <Pressable onPress={() => dismiss(false)} accessibilityRole="button" style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>{GENDER_NOTICE_OK}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: themeColor().scrim,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      zIndex: 900,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
      padding: 20,
    },
    title: { color: themeColor().text, fontSize: 20, ...headline },
    body: { marginTop: 8, color: themeColor().text, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
    actions: { flexDirection: "row", gap: 10, marginTop: 20 },
    secondaryBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.button, borderWidth: 1, borderColor: themeColor().line },
    secondaryText: { color: themeColor().text, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    primaryBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.button, backgroundColor: themeColor().pitch },
    primaryText: { color: themeColor().onPitch, fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    pressed: { opacity: 0.85 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
