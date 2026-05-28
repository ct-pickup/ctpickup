import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, usePathname } from "@react-navigation/native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

function AdminNavDebug() {
  const pathname = usePathname();
  const navigation = useNavigation();

  useEffect(() => {
    const state = navigation.getState();
    const routes = state?.routes ?? [];
    const idx = state?.index ?? 0;
    const prev = idx > 0 ? routes[idx - 1] : null;
    // #region agent log
    fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f137f7" },
      body: JSON.stringify({
        sessionId: "f137f7",
        hypothesisId: "B,E",
        location: "admin/_layout.tsx:AdminNavDebug",
        message: "admin nav state on route change",
        data: {
          pathname,
          stackIndex: idx,
          routeCount: routes.length,
          prevRouteName: prev && "name" in prev ? String(prev.name) : null,
          currentRouteName: routes[idx] && "name" in routes[idx] ? String(routes[idx].name) : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [pathname, navigation]);

  return null;
}

export default function AdminLayout() {
  const { session, isReady: authReady } = useAuth();
  const { isAdmin, isReady: profileAdminReady } = useProfileAdmin();
  const { enabled: adminModeEnabled, isReady: adminModeReady } = useAdminMode();
  const router = useRouter();

  if (!authReady || !profileAdminReady || !adminModeReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.id) {
    return <Redirect href="/login" />;
  }

  if (!isAdmin || !adminModeEnabled) {
    return <Redirect href="/(tabs)/account" />;
  }

  return (
    <>
      <AdminNavDebug />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        headerBackTitle: "Back",
        headerLeft: ({ tintColor, canGoBack }) => {
          // #region agent log
          fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f137f7" },
            body: JSON.stringify({
              sessionId: "f137f7",
              hypothesisId: "A,D",
              location: "admin/_layout.tsx:headerLeft",
              message: "custom headerLeft render",
              data: { canGoBack: !!canGoBack },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          if (!canGoBack) return null;
          return (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.85 : 1 })}
            >
              <FontAwesome name="chevron-left" size={14} color={tintColor ?? "#fff"} />
              <Text style={{ color: tintColor ?? "#fff", fontSize: 16, fontWeight: "600" }}>Back</Text>
            </Pressable>
          );
        },
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="pickup" options={{ title: "Pickup ops", headerShown: false }} />
      <Stack.Screen name="invite-players" options={{ title: "Invite players" }} />
      <Stack.Screen name="run-result" options={{ title: "Run result" }} />
      <Stack.Screen name="analytics" options={{ title: "Analytics" }} />
      <Stack.Screen name="database" options={{ title: "Database", headerShown: false }} />
      <Stack.Screen name="bulk-message" options={{ title: "Broadcast Message" }} />
      <Stack.Screen name="tools" options={{ title: "Admin Tools", headerShown: false }} />
      <Stack.Screen name="proximity-search" options={{ title: "Proximity Search", headerShown: false }} />
      <Stack.Screen name="monthly-leaders" options={{ title: "Monthly Leaders", headerShown: false }} />
      <Stack.Screen name="tier-suggestions" options={{ title: "Tier Suggestions" }} />
      <Stack.Screen name="standing" options={{ title: "Standing" }} />
      <Stack.Screen name="chat" options={{ title: "Chat moderation" }} />
      <Stack.Screen name="chat-room" options={{ title: "Room" }} />
      <Stack.Screen name="tournament" options={{ title: "Tournaments", headerBackTitle: "" }} />
      <Stack.Screen name="tournament-bracket" options={{ title: "Tournament Bracket" }} />
      <Stack.Screen name="tournament-join" options={{ title: "Find a team" }} />
      <Stack.Screen name="tournament-bracket-view" options={{ title: "Live bracket" }} />
      <Stack.Screen name="members" options={{ title: "Members" }} />
    </Stack>
    </>
  );
}
