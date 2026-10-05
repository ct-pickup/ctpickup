import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { goToAdminMenu, isAdminMenuPath } from "@/lib/adminNavigation";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View, type ColorValue } from "react-native";

import { themeColor, useTheme } from "@/theme";
function AdminHeaderBack({ tintColor }: { tintColor?: ColorValue }) {
  useTheme();

  const router = useRouter();
  const pathname = usePathname();
  if (isAdminMenuPath(pathname)) return null;

  return (
    <Pressable
      onPress={() => goToAdminMenu(router)}
      hitSlop={10}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <FontAwesome name="chevron-left" size={14} color={tintColor ?? themeColor().text} />
      <Text style={{ color: tintColor ?? themeColor().text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>Back</Text>
    </Pressable>
  );
}

export default function AdminLayout() {
  useTheme();

  const { session, isReady: authReady } = useAuth();
  const { isAdmin, isReady: profileAdminReady } = useProfileAdmin();
  const { enabled: adminModeEnabled, isReady: adminModeReady } = useAdminMode();

  if (!authReady || !profileAdminReady || !adminModeReady) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={themeColor().text} />
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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: themeColor().bg },
        headerTintColor: themeColor().text,
        headerBackTitle: "Back",
        headerLeft: ({ tintColor }) => <AdminHeaderBack tintColor={tintColor} />,
        contentStyle: { backgroundColor: themeColor().bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Admin", headerShown: false }} />
      <Stack.Screen name="pickup" options={{ title: "Pickup ops", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="invite-players" options={{ title: "Invite players", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="run-result" options={{ title: "Run result", headerBackTitle: "Back" }} />
      <Stack.Screen name="analytics" options={{ title: "Analytics", headerBackTitle: "Back" }} />
      <Stack.Screen name="database" options={{ title: "Database", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="bulk-message" options={{ title: "Broadcast Message", headerBackTitle: "Back" }} />
      <Stack.Screen name="tools" options={{ title: "Admin Tools", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="proximity-search" options={{ title: "Proximity Search", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="monthly-leaders" options={{ title: "Monthly Leaders", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="season-prize" options={{ title: "Season prize", headerShown: false, headerBackTitle: "Back" }} />
      <Stack.Screen name="tier-suggestions" options={{ title: "Tier Suggestions", headerBackTitle: "Back" }} />
      <Stack.Screen name="standing" options={{ title: "Standing", headerBackTitle: "Back" }} />
      <Stack.Screen name="chat" options={{ title: "Chat moderation", headerBackTitle: "Back" }} />
      <Stack.Screen name="chat-room" options={{ title: "Room", headerBackTitle: "Back" }} />
      <Stack.Screen name="tournament" options={{ title: "Tournaments", headerBackTitle: "Back" }} />
      <Stack.Screen name="tournament-bracket" options={{ title: "Tournament Bracket", headerBackTitle: "Back" }} />
      <Stack.Screen name="tournament-join" options={{ title: "Find a team", headerBackTitle: "Back" }} />
      <Stack.Screen name="tournament-bracket-view" options={{ title: "Live bracket", headerBackTitle: "Back" }} />
      <Stack.Screen name="members" options={{ title: "Members", headerBackTitle: "Back" }} />
      <Stack.Screen name="verification" options={{ title: "Verification", headerBackTitle: "Back" }} />
      <Stack.Screen name="tier-management" options={{ title: "Player levels", headerBackTitle: "Back" }} />
      <Stack.Screen name="session-economics" options={{ title: "Payouts", headerBackTitle: "Back" }} />
      <Stack.Screen name="photo-reports" options={{ title: "Photo reports", headerBackTitle: "Back" }} />
    </Stack>
  );
}
