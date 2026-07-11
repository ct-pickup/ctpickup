import React, { useCallback, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Redirect, Tabs, useFocusEffect, useRouter, type Href } from "expo-router";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hapticTap } from "@/lib/haptics";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useWaiver } from "@/context/WaiverContext";
import { RunsPickerBridgeProvider } from "@/context/RunsPickerBridge";
import { hasCompletedOnboarding } from "@/lib/onboarding";

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

const LIME = "#a3e635";
const INACTIVE = "rgba(255,255,255,0.42)";

/**
 * The redesigned 5-slot bar: Home · Map · Host (elevated) · Rankings · Profile,
 * plus a conditional 6th Admin slot. Map / Host / Rankings jump to root-level
 * routes (they aren't tab screens), so we drive navigation manually rather than
 * rely on the default tab bar. Home / Profile / Admin map to registered tab
 * screens and light up when active.
 */
function CTTabBar({ state, navigation, isAdmin }: BottomTabBarProps & { isAdmin: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name ?? "index";

  const goTab = useCallback(
    (name: string) => {
      void hapticTap();
      if (activeName !== name) navigation.navigate(name as never);
    },
    [navigation, activeName],
  );

  const goRoute = useCallback(
    (href: string) => {
      void hapticTap();
      (router.push as (href: string) => void)(href);
    },
    [router],
  );

  const openCreateMenu = useCallback(() => {
    void hapticTap();
    const push = router.push as (href: string) => void;
    Alert.alert("Create", "What would you like to start?", [
      { text: "Host a Session", onPress: () => push("/session-create") },
      { text: "Start Training", onPress: () => push("/training-post") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [router]);

  return (
    <View
      style={[
        tabStyles.bar,
        { paddingBottom: Math.max(insets.bottom, 8), height: 60 + Math.max(insets.bottom, 8) },
      ]}
    >
      <TabItem
        icon="home"
        label="Home"
        active={activeName === "index"}
        onPress={() => goTab("index")}
      />
      <TabItem
        icon="trophy"
        label="Tournaments"
        active={activeName === "tournaments"}
        onPress={() => goTab("tournaments")}
      />
      <HostButton onPress={openCreateMenu} />
      <TabItem icon="trophy" label="Rankings" active={false} onPress={() => goRoute("/leaderboards")} />
      <TabItem
        icon="user"
        label="Profile"
        active={activeName === "account"}
        onPress={() => goTab("account")}
      />
      {isAdmin && (
        <TabItem
          icon="shield"
          label="Admin"
          active={activeName === "admin"}
          onPress={() => goTab("admin")}
        />
      )}
    </View>
  );
}

function TabItem(props: {
  icon: React.ComponentProps<typeof FontAwesome>["name"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const color = props.active ? LIME : INACTIVE;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={tabStyles.item}
      hitSlop={6}
    >
      <FontAwesome name={props.icon} size={22} color={color} />
      <Text style={[tabStyles.label, { color }]} numberOfLines={1} allowFontScaling={false}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function HostButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={tabStyles.hostSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Host a session"
        onPress={onPress}
        style={({ pressed }) => [tabStyles.hostBtn, pressed && { transform: [{ scale: 0.94 }] }]}
      >
        <FontAwesome name="plus" size={26} color="#0a0a0a" />
      </Pressable>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#050505",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-start", gap: 3 },
  label: { fontSize: 10, fontWeight: "600", letterSpacing: 0.2 },
  hostSlot: { flex: 1, alignItems: "center" },
  hostBtn: {
    position: "absolute",
    top: -26,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#050505",
    shadowColor: LIME,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
});

function TabsWithRunsPickerReset(props: { adminModeEnabled: boolean; isAdmin: boolean }) {
  const showAdmin = props.isAdmin && props.adminModeEnabled;

  return (
    <Tabs
      tabBar={(bar) => <CTTabBar {...bar} isAdmin={showAdmin} />}
      screenOptions={{
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false }} />
      <Tabs.Screen name="runs" options={{ title: "Pickup" }} />
      <Tabs.Screen name="tournaments" options={{ title: "Tournaments" }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false }} />
      <Tabs.Screen name="account" options={{ title: "Profile" }} />
      <Tabs.Screen name="admin" options={{ title: "Admin", headerShown: false }} />
    </Tabs>
  );
}
