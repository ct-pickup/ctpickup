import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function AdminLayout() {
  const { session, isReady: authReady } = useAuth();
  const { isAdmin, isReady: profileAdminReady } = useProfileAdmin();
  const { enabled: adminModeEnabled, isReady: adminModeReady } = useAdminMode();

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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="pickup" options={{ title: "Pickup ops" }} />
      <Stack.Screen name="analytics" options={{ title: "Analytics" }} />
      <Stack.Screen name="tier-suggestions" options={{ title: "Tier Suggestions" }} />
      <Stack.Screen name="standing" options={{ title: "Standing" }} />
      <Stack.Screen name="chat" options={{ title: "Chat moderation" }} />
      <Stack.Screen name="chat-room" options={{ title: "Room" }} />
      <Stack.Screen name="tournament" options={{ title: "Tournament hub" }} />
      <Stack.Screen name="tournament-bracket" options={{ title: "Tournament Bracket" }} />
      <Stack.Screen name="tournament-join" options={{ title: "Find a team" }} />
      <Stack.Screen name="tournament-bracket-view" options={{ title: "Live bracket" }} />
      <Stack.Screen name="members" options={{ title: "Members" }} />
    </Stack>
  );
}
