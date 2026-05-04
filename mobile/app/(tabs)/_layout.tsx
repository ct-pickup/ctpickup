import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { RunsPickerBridgeProvider } from "@/context/RunsPickerBridge";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={26} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const { session, isReady } = useAuth();
  const { enabled: adminModeEnabled, isReady: adminModeReady } = useAdminMode();

  if (!isReady || !adminModeReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  return (
    <RunsPickerBridgeProvider>
      <TabsWithRunsPickerReset adminModeEnabled={adminModeEnabled} signedEmail={session.user.email} />
    </RunsPickerBridgeProvider>
  );
}

function TabsWithRunsPickerReset(props: { adminModeEnabled: boolean; signedEmail: string }) {
  const lime = "#a3e635";
  const showAdmin = props.signedEmail.toLowerCase() === "omeedpooya@gmail.com" && props.adminModeEnabled;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: lime,
        tabBarInactiveTintColor: "rgba(255,255,255,0.4)",
        tabBarStyle: { backgroundColor: "#050505", borderTopColor: "rgba(255,255,255,0.08)" },
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="runs"
        options={{
          title: "Pickup",
          tabBarLabel: "Pickup",
          tabBarIcon: ({ color }) => <TabBarIcon name="futbol-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tournaments"
        options={{
          title: "Tournaments",
          tabBarIcon: ({ color }) => <TabBarIcon name="trophy" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="comment-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          href: showAdmin ? undefined : null,
          title: "Admin",
          tabBarIcon: ({ color }) => <TabBarIcon name="shield" color={color} />,
        }}
      />
    </Tabs>
  );
}
