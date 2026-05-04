import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { AppOpeningTheme, clearAppOpeningThemeFlag } from "@/components/AppOpeningTheme";
import { AppLockOverlay } from "@/components/AppLockOverlay";
import { PushRegistrar } from "@/components/PushRegistrar";
import { AppLockProvider } from "@/context/AppLockContext";
import { AccountIntroReplayProvider } from "@/context/AccountIntroReplayContext";
import { AdminModeProvider } from "@/context/AdminModeContext";
import { AuthProvider } from "@/context/AuthContext";
import { SelectedRegionProvider } from "@/context/SelectedRegionContext";
import { ReplayOpeningThemeContext } from "@/context/ReplayOpeningThemeContext";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
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

let splashPrepared = false;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (splashPrepared) return;
    splashPrepared = true;
    void SplashScreen.preventAutoHideAsync().catch(() => {
      // Expo Go / fast-refresh can race the native splash registration; ignore.
    });
  }, []);

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
        <AdminModeProvider>
          <SelectedRegionProvider>
            <AppLockProvider>
              <AccountIntroReplayProvider>
                <View style={{ flex: 1 }}>
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
                        name="field-tournament"
                        options={{
                          headerShown: true,
                          title: "Tournament",
                          headerStyle: { backgroundColor: "#0a0a0a" },
                          headerTintColor: "#fff",
                        }}
                      />
                      <Stack.Screen
                        name="esports/[id]"
                        options={{
                          headerShown: true,
                          title: "Esports",
                          headerStyle: { backgroundColor: "#0a0a0a" },
                          headerTintColor: "#fff",
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
      </AuthProvider>
    </ReplayOpeningThemeContext.Provider>
  );
}
