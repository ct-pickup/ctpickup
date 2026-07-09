import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,
  debug: false,
  tracesSampleRate: 0.1,
});

import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { AppOpeningTheme, clearAppOpeningThemeFlag } from "@/components/AppOpeningTheme";
import { AppLockOverlay } from "@/components/AppLockOverlay";
import { PushRegistrar } from "@/components/PushRegistrar";
import { ReviewModeBanner } from "@/components/ReviewModeBanner";
import { AppLockProvider } from "@/context/AppLockContext";
import { AccountIntroReplayProvider } from "@/context/AccountIntroReplayContext";
import { AdminModeProvider } from "@/context/AdminModeContext";
import { AuthProvider } from "@/context/AuthContext";
import { ProfileCompletionProvider } from "@/context/ProfileCompletionContext";
import { ProfileAdminProvider } from "@/context/ProfileAdminContext";
import { ReviewModeProvider } from "@/context/ReviewModeContext";
import { WaiverProvider } from "@/context/WaiverContext";
import { SelectedRegionProvider } from "@/context/SelectedRegionContext";
import { ReplayOpeningThemeContext } from "@/context/ReplayOpeningThemeContext";
import { authRouteRef } from "@/lib/authRouteRef";
import { useFonts } from "expo-font";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import "react-native-reanimated";
import Constants from "expo-constants";
import * as Linking from "expo-linking";

import { useColorScheme } from "@/components/useColorScheme";
import Colors, { CT_PICKUP_LIME } from "@/constants/Colors";
import { siteOrigin } from "@/lib/env";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Must run before first render.
void SplashScreen.preventAutoHideAsync().catch(() => {
  // Expo Go / fast-refresh can race the native splash registration; ignore.
});

function AuthRouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    authRouteRef.current = pathname ?? "";
  }, [pathname]);
  return null;
}

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      void SplashScreen.hideAsync().catch(() => {
        // If splash isn't registered (rare), don't crash the app.
      });
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const [openingThemeKey, setOpeningThemeKey] = useState(0);
  const [minVersionBlocked, setMinVersionBlocked] = useState(false);
  const replayOpeningTheme = useCallback(async () => {
    await clearAppOpeningThemeFlag();
    setOpeningThemeKey((k) => k + 1);
  }, []);
  const replayOpeningThemeCtx = useMemo(() => ({ replayOpeningTheme }), [replayOpeningTheme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const origin = siteOrigin();
        if (!origin) return;

        const res = await fetch(`${origin}/api/app-version`);
        const j = (await res.json()) as { min_version?: unknown };
        if (!res.ok) return;
        if (cancelled) return;

        const minV = typeof j.min_version === "string" ? j.min_version.trim() : "";
        const curV = String(Constants.expoConfig?.version ?? "").trim();
        if (!minV || !curV) return;

        const isBelow = compareSemver(curV, minV) < 0;
        if (isBelow) setMinVersionBlocked(true);
      } catch {
        // If version check fails, don't block app launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ReplayOpeningThemeContext.Provider value={replayOpeningThemeCtx}>
      <AuthProvider>
        <AuthRouteTracker />
        <WaiverProvider>
          <ProfileCompletionProvider>
            <ProfileAdminProvider>
              <ReviewModeProvider>
              <AdminModeProvider>
                <SelectedRegionProvider>
                  <AppLockProvider>
                    <AccountIntroReplayProvider>
                      <View style={{ flex: 1 }}>
                        {minVersionBlocked ? <UpdateRequiredGate /> : null}
                        <ReviewModeBanner />
                        <PushRegistrar />
                        <ThemeProvider
                          value={
                            colorScheme === "dark"
                              ? DarkTheme
                              : {
                                  ...DefaultTheme,
                                  colors: {
                                    ...DefaultTheme.colors,
                                    background: Colors.light.background,
                                    card: Colors.light.background,
                                    primary: CT_PICKUP_LIME,
                                    text: Colors.light.text,
                                    border: "rgba(10,10,10,0.12)",
                                    notification: "#111",
                                  },
                                }
                          }
                        >
                          <Stack>
                            <Stack.Screen
                            name="(tabs)"
                            options={{
                              headerShown: false,
                              title: "Home",
                              headerBackTitle: "Back",
                            }}
                          />
                          <Stack.Screen
                            name="login"
                            options={{
                              headerShown: false,
                              title: "CT Pickup",
                            }}
                          />
                          <Stack.Screen
                            name="waiver"
                            options={{
                              headerShown: false,
                              title: "Waiver",
                            }}
                          />
                          <Stack.Screen
                            name="complete-profile"
                            options={{
                              headerShown: false,
                              title: "Complete profile",
                              gestureEnabled: false,
                              headerBackVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="onboarding"
                            options={{
                              headerShown: false,
                              title: "Welcome",
                              gestureEnabled: false,
                              headerBackVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="rules"
                            options={{
                              headerShown: true,
                              title: "Rules",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="reset-password"
                            options={{
                              headerShown: true,
                              title: "Set new password",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="field-tournament"
                            options={{
                              headerShown: true,
                              title: "Tournament",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="regions"
                            options={{
                              headerShown: true,
                              title: "Pickup by state",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="region/[code]"
                            options={{
                              headerShown: true,
                              title: "Region",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="how-pickup-works"
                            options={{
                              headerShown: true,
                              title: "How pickup works",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="pickup-status"
                            options={{
                              headerShown: true,
                              title: "Pickup status",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="tournament-status"
                            options={{
                              headerShown: true,
                              title: "Tournament status",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="help"
                            options={{
                              headerShown: true,
                              title: "Help",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="privacy-policy"
                            options={{
                              headerShown: true,
                              title: "Privacy Policy",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="terms"
                            options={{
                              headerShown: true,
                              title: "Terms of Service",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="tournament-join"
                            options={{
                              headerShown: true,
                              title: "Find a team",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="tournament-bracket-view"
                            options={{
                              headerShown: true,
                              title: "Live bracket",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="following"
                            options={{
                              headerShown: true,
                              title: "Followers & following",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="players"
                            options={{
                              headerShown: true,
                              title: "Players",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="player/[id]"
                            options={{
                              headerShown: true,
                              title: "Profile",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen name="player-card/[id]" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="leaderboards"
                            options={{
                              headerShown: true,
                              title: "Leaderboards",
                              headerTitleAlign: "center",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="run-history"
                            options={{
                              headerShown: true,
                              title: "Run history",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="run/[id]"
                            options={{
                              headerShown: true,
                              title: "Run",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="session-map"
                            options={{ headerShown: false }}
                          />
                          <Stack.Screen
                            name="session/[id]"
                            options={{
                              headerShown: true,
                              title: "Session",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="session-create"
                            options={{
                              headerShown: true,
                              title: "Host a Session",
                              headerStyle: { backgroundColor: "#0a0a0a" },
                              headerTintColor: "#fff",
                            }}
                          />
                          <Stack.Screen
                            name="peer-vote/[id]"
                            options={{
                              headerShown: false,
                              gestureEnabled: false,
                            }}
                          />
                          </Stack>
                        </ThemeProvider>
                        <AppOpeningTheme key={openingThemeKey} />
                        <AppLockOverlay />
                      </View>
                    </AccountIntroReplayProvider>
                  </AppLockProvider>
                </SelectedRegionProvider>
              </AdminModeProvider>
              </ReviewModeProvider>
            </ProfileAdminProvider>
          </ProfileCompletionProvider>
        </WaiverProvider>
      </AuthProvider>
    </ReplayOpeningThemeContext.Provider>
  );
}

export default Sentry.wrap(RootLayout);

function parseSemver(raw: string): [number, number, number] | null {
  const s = raw.trim();
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}

function compareSemver(aRaw: string, bRaw: string): -1 | 0 | 1 {
  const a = parseSemver(aRaw);
  const b = parseSemver(bRaw);
  if (!a || !b) return 0;
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

function UpdateRequiredGate() {
  return (
    <View style={stylesUpdateGate.root} pointerEvents="auto">
      <View style={stylesUpdateGate.card}>
        <Text style={stylesUpdateGate.title}>Update Required</Text>
        <Text style={stylesUpdateGate.body}>
          A new version of CT Pickup is available. Please update to continue.
        </Text>
        <Pressable
          onPress={() => {
            void Linking.openURL("https://apps.apple.com/app/id6766061001");
          }}
          style={({ pressed }) => [stylesUpdateGate.btn, pressed && { opacity: 0.9 }]}
        >
          <Text style={stylesUpdateGate.btnText}>Update Now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const stylesUpdateGate = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1000,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 20,
  },
  title: { color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center" },
  body: {
    marginTop: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  btn: {
    marginTop: 18,
    backgroundColor: CT_PICKUP_LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#111", fontSize: 16, fontWeight: "900" },
});
