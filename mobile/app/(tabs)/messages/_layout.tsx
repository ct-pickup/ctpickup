import { Stack } from "expo-router";

import { themeColor, useTheme } from "@/theme";
export default function MessagesStackLayout() {
  useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: themeColor().bg },
        headerTintColor: themeColor().text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: themeColor().bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Messages" }} />
      <Stack.Screen name="thread" options={{ title: "Messages" }} />
      <Stack.Screen name="profile/[userId]" options={{ title: "Profile" }} />
    </Stack>
  );
}
