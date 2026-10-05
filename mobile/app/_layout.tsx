import * as Sentry from "@sentry/react-native";
import "@/lib/appVersionHeader";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,
  debug: false,
  tracesSampleRate: 0.1,
});

import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { AppOpeningTheme, clearAppOpeningThemeFlag } from "@/components/AppOpeningTheme";
import { AppLockOverlay } from "@/components/AppLockOverlay";
import { CancellationPolicyNotice } from "@/components/CancellationPolicyNotice";
import { PushRegistrar } from "@/components/PushRegistrar";
import { ReviewModeBanner } from "@/components/ReviewModeBanner";
import { AppLockProvider } from "@/context/AppLockContext";
import { AccountIntroReplayProvider } from "@/context/AccountIntroReplayContext";
import { AdminModeProvider } from "@/context/AdminModeContext";
import { AppearanceProvider, useAppearance } from "@/context/AppearanceContext";
import { AuthProvider } from "@/context/AuthContext";
import { CtPlusProvider } from "@/context/CtPlusContext";
import { ProfileCompletionProvider } from "@/context/ProfileCompletionContext";
import { ProfilePhotoProvider } from "@/context/ProfilePhotoContext";
import { ProfileAdminProvider } from "@/context/ProfileAdminContext";
import { ReviewModeProvider } from "@/context/ReviewModeContext";
import { WaiverProvider } from "@/context/WaiverContext";
import { SelectedRegionProvider } from "@/context/SelectedRegionContext";
import { ReplayOpeningThemeContext } from "@/context/ReplayOpeningThemeContext";
import { authRouteRef } from "@/lib/authRouteRef";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Archivo_700Bold } from "@expo-google-fonts/archivo";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import "react-native-reanimated";
import Constants from "expo-constants";
import * as Linking from "expo-linking";

import { useColorScheme } from "@/components/useColorScheme";
import { siteOrigin } from "@/lib/env";
import { isUpdateRequired } from "@/lib/semver";

import { headline, themeColor, useThemedStyles } from "@/theme";
import { PRODUCT_NAME } from "@/lib/brand";
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
  useThemedStyles(publish_stylesUpdateGate);

  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    InstrumentSerif_400Regular,
    Archivo_700Bold,
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Hold the splash until the stored Appearance choice is applied so a dark-preference user never sees a light frame and vice versa.
  const { isReady: appearanceReady } = useAppearance();
  const ready = loaded && appearanceReady;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => {
        // If splash isn't registered (rare), don't crash the app.
      });
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutWithAppearance() {
  return (
    <AppearanceProvider>
      <RootLayout />
    </AppearanceProvider>
  );
}

function RootLayoutNav() {
  useThemedStyles(publish_stylesUpdateGate);

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

        if (isUpdateRequired(curV, minV)) setMinVersionBlocked(true);
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
                    <CtPlusProvider>
                    <ProfilePhotoProvider>
                      <View style={{ flex: 1 }}>
                        {minVersionBlocked ? <UpdateRequiredGate /> : null}
                        <ReviewModeBanner />
                        <PushRegistrar />
                        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
                        <ThemeProvider
                          value={{
                            ...(colorScheme === "dark" ? DarkTheme : DefaultTheme),
                            colors: {
                              ...(colorScheme === "dark" ? DarkTheme : DefaultTheme).colors,
                              background: themeColor().bg,
                              card: themeColor().card,
                              primary: themeColor().pitchText,
                              text: themeColor().text,
                              border: themeColor().line,
                              notification: themeColor().pitch,
                            },
                          }}
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
                              title: PRODUCT_NAME,
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
                            name="season-prize"
                            options={{
                              headerShown: false,
                              title: "Win the season",
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
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="settings"
                            options={{
                              headerShown: true,
                              title: "Settings",
                              headerBackTitle: "Profile",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="instagram-verification"
                            options={{
                              headerShown: true,
                              title: "Verification",
                              headerBackTitle: "Settings",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="reset-password"
                            options={{
                              headerShown: true,
                              title: "Set new password",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="field-tournament"
                            options={{
                              headerShown: true,
                              title: "Tournament",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="regions"
                            options={{
                              headerShown: true,
                              title: "Pickup by state",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="region/[code]"
                            options={{
                              headerShown: true,
                              title: "Region",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="how-pickup-works"
                            options={{
                              headerShown: true,
                              title: "How pickup works",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="pickup-status"
                            options={{
                              headerShown: true,
                              title: "Pickup status",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="tournament-status"
                            options={{
                              headerShown: true,
                              title: "Tournament status",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="help"
                            options={{
                              headerShown: true,
                              title: "Help",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="privacy-policy"
                            options={{
                              headerShown: true,
                              title: "Privacy Policy",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="terms"
                            options={{
                              headerShown: true,
                              title: "Terms of Service",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="tournament-join"
                            options={{
                              headerShown: true,
                              title: "Find a team",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="tournament-bracket-view"
                            options={{
                              headerShown: true,
                              title: "Live bracket",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="contacts-invite"
                            options={{
                              headerShown: true,
                              title: "Invite friends",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="season-stats"
                            options={{
                              headerShown: true,
                              title: "Season stats",
                              headerBackTitle: "Profile",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="player-directory"
                            options={{
                              headerShown: true,
                              title: "Players near you",
                              headerBackTitle: "Players",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="season-rules"
                            options={{
                              headerShown: true,
                              title: "Official rules",
                              headerBackTitle: "Back",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="following"
                            options={{
                              headerShown: true,
                              title: "Followers & following",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="players"
                            options={{
                              headerShown: true,
                              title: "Players",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="player/[id]"
                            options={{
                              headerShown: true,
                              title: "Profile",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                              headerBackTitle: "",
                            }}
                          />
                          <Stack.Screen name="player-card/[id]" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="leaderboards"
                            options={{
                              headerShown: true,
                              title: "Leaderboards",
                              headerTitleAlign: "center",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="run-history"
                            options={{
                              headerShown: true,
                              title: "Run history",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="run/[id]"
                            options={{
                              headerShown: true,
                              title: "Run",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="recap/[id]"
                            options={{
                              headerShown: true,
                              title: "Game recap",
                              headerBackTitle: "Games",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="session-map"
                            options={{ headerShown: false, title: "Games", headerBackTitle: "Games" }}
                          />
                          <Stack.Screen
                            name="session/[id]"
                            options={{
                              headerShown: true,
                              title: "Session",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                              headerShadowVisible: false,
                            }}
                          />
                          <Stack.Screen
                            name="session-create"
                            options={{
                              headerShown: true,
                              title: "Host a Session",
                              headerStyle: { backgroundColor: themeColor().bg },
                              headerTintColor: themeColor().text,
                            }}
                          />
                          <Stack.Screen
                            name="peer-vote/[id]"
                            options={{
                              headerShown: false,
                              gestureEnabled: false,
                            }}
                          />
                          <Stack.Screen
                            name="peer-ratings/[id]"
                            options={{
                              headerShown: false,
                              presentation: "modal",
                            }}
                          />
                          </Stack>
                        </ThemeProvider>
                        {minVersionBlocked ? null : <CancellationPolicyNotice />}
                        <AppOpeningTheme key={openingThemeKey} />
                        <AppLockOverlay />
                      </View>
                    </ProfilePhotoProvider>
                    </CtPlusProvider>
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

export default Sentry.wrap(RootLayoutWithAppearance);

function UpdateRequiredGate() {
  useThemedStyles(publish_stylesUpdateGate);

  return (
    <View style={stylesUpdateGate.root} pointerEvents="auto">
      <View style={stylesUpdateGate.card}>
        <Text style={stylesUpdateGate.title}>Update Required</Text>
        <Text style={stylesUpdateGate.body}>
          A new version of {PRODUCT_NAME} is available. Please update to continue.
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

function make_stylesUpdateGate() {
  return StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: themeColor().bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1000,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
    padding: 20,
  },
  title: { color: themeColor().text, fontSize: 24, ...headline, textAlign: "center" },
  body: {
    marginTop: 8,
    color: themeColor().muted,
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  btn: {
    marginTop: 16,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: themeColor().onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "900" },
});
}
let stylesUpdateGate = make_stylesUpdateGate();
function publish_stylesUpdateGate() {
  stylesUpdateGate = make_stylesUpdateGate();
}

