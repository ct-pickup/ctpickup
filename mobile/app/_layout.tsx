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
import { View } from "react-native";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import Colors, { CT_PICKUP_LIME } from "@/constants/Colors";

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
  const replayOpeningTheme = useCallback(async () => {
    await clearAppOpeningThemeFlag();
    setOpeningThemeKey((k) => k + 1);
  }, []);
  const replayOpeningThemeCtx = useMemo(() => ({ replayOpeningTheme }), [replayOpeningTheme]);

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
                              title: "Reset password",
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
                          <Stack.Screen name="admin/pickup" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/invite-players" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/run-result" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/tournament" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/tournament-bracket" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/members" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/analytics" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/database" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/tier-suggestions" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/bulk-message" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/tournament-join" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/tournament-bracket-view" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/chat" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/chat-room" options={{ headerShown: false }} />
                          <Stack.Screen name="admin/standing" options={{ headerShown: false }} />
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
