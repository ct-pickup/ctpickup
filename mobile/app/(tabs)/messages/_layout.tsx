import { Stack } from "expo-router";

export default function MessagesStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Messages" }} />
      <Stack.Screen name="thread" options={{ title: "Messages" }} />
      <Stack.Screen name="profile/[userId]" options={{ title: "Profile" }} />
    </Stack>
  );
}
