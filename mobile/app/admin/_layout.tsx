import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        headerBackTitle: "Back",
        headerLeft: ({ tintColor, canGoBack }) => {
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
  );
}
