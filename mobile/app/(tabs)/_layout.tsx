import React, { useCallback, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { CommonActions } from "@react-navigation/native";
import { Redirect, Tabs, useFocusEffect, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useWaiver } from "@/context/WaiverContext";
import { RunsPickerBridgeProvider } from "@/context/RunsPickerBridge";
import { hasCompletedOnboarding } from "@/lib/onboarding";

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
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const userId = session?.user?.id;

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setOnboardingChecked(false);
        setOnboardingComplete(false);
        return;
      }

      let cancelled = false;
      setOnboardingChecked(false);

      void (async () => {
        const done = await hasCompletedOnboarding();
        if (cancelled) return;
        setOnboardingComplete(done);
        setOnboardingChecked(true);
      })();

      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

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

  if (!onboardingChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!onboardingComplete) {
    return <Redirect href="/onboarding" />;
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
          tabPress: (e) => {
            const state = navigation.getState();
            const messagesRoute = state.routes.find((r) => r.name === "messages");
            const stackIndex =
              messagesRoute && "state" in messagesRoute && messagesRoute.state
                ? ((messagesRoute.state as { index?: number }).index ?? 0)
                : 0;
            if (stackIndex > 0) {
              e.preventDefault();
              navigation.dispatch(
                CommonActions.navigate({
                  name: "messages",
                  params: { screen: "index" },
                  merge: true,
                }),
              );
            }
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
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="shield" color={color} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            const state = navigation.getState();
            const adminRoute = state.routes.find((r) => r.name === "admin");
            const stackIndex =
              adminRoute && "state" in adminRoute && adminRoute.state
                ? ((adminRoute.state as { index?: number }).index ?? 0)
                : 0;
            if (stackIndex > 0) {
              e.preventDefault();
              navigation.dispatch(
                CommonActions.navigate({
                  name: "admin",
                  params: { screen: "index" },
                  merge: true,
                }),
              );
            }
          },
        })}
      />
    </Tabs>
  );
}
