import { Stack } from "expo-router";

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="pickup" options={{ title: "Pickup ops" }} />
      <Stack.Screen name="standing" options={{ title: "Standing" }} />
      <Stack.Screen name="chat" options={{ title: "Chat moderation" }} />
      <Stack.Screen name="chat-room" options={{ title: "Room" }} />
    </Stack>
  );
}

