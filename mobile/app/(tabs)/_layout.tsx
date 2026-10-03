import React, { useCallback, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Redirect, Tabs, useFocusEffect, useRouter, type Href } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CreateMenuSheet } from "@/components/CreateMenuSheet";
import { hapticTap } from "@/lib/haptics";
import { useHostedRunNeedingResult } from "@/lib/useHostedRunNeedingResult";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useWaiver } from "@/context/WaiverContext";
import { RunsPickerBridgeProvider } from "@/context/RunsPickerBridge";
import { hasCompletedOnboarding } from "@/lib/onboarding";

import { themeColor, useThemedStyles } from "@/theme";
export default function TabLayout() {
  useThemedStyles(publish_tabStyles);

  const { session, isReady } = useAuth();
  const { isReady: adminModeReady } = useAdminMode();
  const { isReady: profileAdminReady } = useProfileAdmin();
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
      <View style={{ flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  if (waiverLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!waiverAccepted) {
    return <Redirect href="/waiver" />;
  }

  if (profileGateLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (profileNeedsCompletion) {
    return <Redirect href={"/complete-profile" as Href} />;
  }

  if (!onboardingChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!onboardingComplete) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <RunsPickerBridgeProvider>
      <TabsWithRunsPickerReset />
    </RunsPickerBridgeProvider>
  );
}

/**
 * The 5-slot bar: Home · Games · + (elevated) · Players · Profile. There is no Admin
 * slot; admins reach the admin home from the row at the top of Settings. The + opens
 * the create menu sheet.
 */
function CTTabBar({ state, navigation }: BottomTabBarProps) {
  useThemedStyles(publish_tabStyles);

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

  const [createOpen, setCreateOpen] = useState(false);
  const resultRunId = useHostedRunNeedingResult(createOpen);

  const openCreateMenu = useCallback(() => {
    void hapticTap();
    setCreateOpen(true);
  }, []);

  const push = router.push as (href: string) => void;

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
        icon="soccer-ball-o"
        label="Games"
        active={activeName === "sessions"}
        onPress={() => goTab("sessions")}
      />
      <HostButton onPress={openCreateMenu} />
      <TabItem icon="users" label="Players" active={activeName === "leaderboards"} onPress={() => goTab("leaderboards")} />
      <TabItem
        icon="user"
        label="Profile"
        active={activeName === "account"}
        onPress={() => goTab("account")}
      />

      <CreateMenuSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onHostGame={() => push("/session-create")}
        resultRunId={resultRunId}
        onPostResult={(runId) => push(`/session/${runId}`)}
      />
    </View>
  );
}

function TabItem(props: {
  icon: React.ComponentProps<typeof FontAwesome>["name"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  useThemedStyles(publish_tabStyles);

  const color = props.active ? themeColor().accent : themeColor().muted;
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
  useThemedStyles(publish_tabStyles);

  return (
    <View style={tabStyles.hostSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Host a game"
        onPress={onPress}
        style={({ pressed }) => [tabStyles.hostBtn, pressed && { transform: [{ scale: 0.94 }] }]}
      >
        <FontAwesome name="plus" size={26} color={themeColor().onAccent} />
      </Pressable>
    </View>
  );
}

function make_tabStyles() {
  return StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: themeColor().bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColor().line,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-start", gap: 4 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600",},
  hostSlot: { flex: 1, alignItems: "center" },
  hostBtn: {
    position: "absolute",
    top: -26,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: themeColor().accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
}
let tabStyles = make_tabStyles();
function publish_tabStyles() {
  tabStyles = make_tabStyles();
}


function TabsWithRunsPickerReset() {
  useThemedStyles(publish_tabStyles);

  return (
    <Tabs
      tabBar={(bar: BottomTabBarProps) => <CTTabBar {...bar} />}
      screenOptions={{
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: themeColor().bg },
        headerTintColor: themeColor().text,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false }} />
      <Tabs.Screen name="runs" options={{ title: "Pickup", href: null }} />
      <Tabs.Screen name="sessions" options={{ title: "Games", headerShown: false }} />
      <Tabs.Screen name="tournaments" options={{ title: "Tournaments", href: null }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false }} />
      <Tabs.Screen name="account" options={{ title: "Profile", headerShown: false }} />
      <Tabs.Screen name="leaderboards" options={{ title: "Rankings" }} />
      <Tabs.Screen name="admin" options={{ title: "Admin", headerShown: false, href: null }} />
    </Tabs>
  );
}
