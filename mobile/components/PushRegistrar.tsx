import * as Notifications from "expo-notifications";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfilePhoto } from "@/context/ProfilePhotoContext";
import { useWaiver } from "@/context/WaiverContext";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { hasCompletedOnboarding } from "@/lib/onboarding";
import { shouldRegisterPushToken } from "@/lib/pushToken";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const PROMPT_KEY = "ctpickup_push_preprompt_v1";
/** One ask after onboarding, then at most one more, after the player's first joined game. */
const MAX_ASKS = 2;
/** Let the first screen settle (and the photo sheet go first) before asking. */
const SETTLE_MS = 1500;
const NO_PROMPT_PATHS = ["/login", "/waiver", "/complete-profile", "/onboarding", "/reset-password"];

type Stored = { asked: number; accepted: boolean };

async function loadStored(): Promise<Stored> {
  try {
    const raw = await appAsyncStorage.getItem(PROMPT_KEY);
    const j = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    return { asked: Number(j?.asked) || 0, accepted: j?.accepted === true };
  } catch {
    return { asked: 0, accepted: false };
  }
}

async function saveStored(s: Stored): Promise<void> {
  try {
    await appAsyncStorage.setItem(PROMPT_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * Push registration, with the system permission prompt held back until the player has seen a short explanation.
 * usePushRegistration is unchanged: it only gets a token once the permission is already decided or the player
 * tapped "Turn on", which is what lets it show the system prompt.
 */
export function PushRegistrar() {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { session, supabase } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();
  const { sheetOpen } = useProfilePhoto();
  const token = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;

  const [stored, setStored] = useState<Stored | null>(null);
  const [permission, setPermission] = useState<Notifications.PermissionStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const checkedFirstGame = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadStored(), Notifications.getPermissionsAsync().catch(() => null)]).then(([s, p]) => {
      if (cancelled) return;
      setStored(s);
      setPermission(p?.status ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Registration only runs once the permission is decided (granted or denied earlier) or the player tapped "Turn on".
  const mayRegister = permission != null && (permission !== "undetermined" || stored?.accepted === true);
  usePushRegistration(mayRegister ? token : null);

  const gatesPassed =
    !!userId && !waiverLoading && waiverAccepted && !profileGateLoading && !profileNeedsCompletion;
  const onQuietScreen = !NO_PROMPT_PATHS.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    if (!gatesPassed || !onQuietScreen || sheetOpen || visible) return;
    if (stored == null || permission !== "undetermined" || stored.accepted || stored.asked >= MAX_ASKS) return;
    if (!shouldRegisterPushToken()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await hasCompletedOnboarding()) || cancelled) return;
        if (stored.asked === 0) {
          setVisible(true);
          return;
        }
        // Asked once already: ask again only after the first joined game.
        if (!supabase || !userId || checkedFirstGame.current === userId) return;
        checkedFirstGame.current = userId;
        const { data } = await supabase
          .from("pickup_run_rsvps")
          .select("run_id")
          .eq("user_id", userId)
          .eq("status", "confirmed")
          .limit(1);
        if (!cancelled && (data?.length ?? 0) > 0) setVisible(true);
      })();
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gatesPassed, onQuietScreen, sheetOpen, visible, stored, permission, supabase, userId, pathname]);

  const answer = useCallback(
    (turnOn: boolean) => {
      const next: Stored = { asked: (stored?.asked ?? 0) + 1, accepted: turnOn };
      setStored(next);
      setVisible(false);
      void saveStored(next);
    },
    [stored],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => answer(false)}>
      <View style={styles.root}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <Text style={styles.title}>Get told when a game fills up or changes</Text>
          <Text style={styles.body}>Turn on notifications so you don&apos;t miss a spot, a time change or a cancellation.</Text>
          <Pressable onPress={() => answer(true)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.primaryText}>Turn on</Text>
          </Pressable>
          <Pressable onPress={() => answer(false)} hitSlop={8} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, paddingTop: 24, gap: 12 },
    title: { color: c.text, fontSize: 22, ...headline, textAlign: "center" },
    body: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
    primary: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", marginTop: 4 },
    primaryText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    pressed: { opacity: 0.85 },
    secondary: { alignSelf: "center", paddingVertical: 8 },
    secondaryText: { color: c.muted, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
