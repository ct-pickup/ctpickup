import { Stack } from "expo-router";

export default function EsportsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="[id]" options={{ title: "Esports", headerBackTitle: "Back" }} />
    </Stack>
  );
}
