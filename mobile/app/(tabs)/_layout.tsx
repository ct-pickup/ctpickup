import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, Tabs, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useWaiver } from "@/context/WaiverContext";
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
  const { isAdmin, isReady: profileAdminReady } = useProfileAdmin();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();

  if (!isReady || !adminModeReady || !profileAdminReady) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  if (waiverLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!waiverAccepted) {
    return <Redirect href="/waiver" />;
  }

  if (profileGateLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (profileNeedsCompletion) {
    return <Redirect href={"/complete-profile" as Href} />;
  }

  return (
    <RunsPickerBridgeProvider>
      <TabsWithRunsPickerReset adminModeEnabled={adminModeEnabled} isAdmin={isAdmin} />
    </RunsPickerBridgeProvider>
  );
}

function TabsWithRunsPickerReset(props: { adminModeEnabled: boolean; isAdmin: boolean }) {
  const lime = "#a3e635";
  const showAdmin = props.isAdmin && props.adminModeEnabled;

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
        listeners={({ navigation }) => ({
          tabPress: () => {
            // #region agent log
            const state = navigation.getState();
            const messagesRoute = state.routes.find((r) => r.name === "messages");
            const stackIndex =
              messagesRoute && "state" in messagesRoute && messagesRoute.state
                ? (messagesRoute.state as { index?: number }).index
                : 0;
            fetch("http://127.0.0.1:7577/ingest/cb3f3382-e909-4cce-999a-8534dacee8c7", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c3b686" },
              body: JSON.stringify({
                sessionId: "c3b686",
                hypothesisId: "H1",
                location: "(tabs)/_layout.tsx:messages-tabPress",
                message: "messages tab pressed",
                data: { stackIndex, routeNames: messagesRoute?.state },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
          },
        })}
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
