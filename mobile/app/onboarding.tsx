import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useWaiver } from "@/context/WaiverContext";
import { markOnboardingCompleted } from "@/lib/onboarding";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themeColor, useThemedStyles } from "@/theme";
type Slide =
  | { kind: "logo"; title: string; body: string }
  | { kind: "emoji"; icon: string; title: string; body: string };

const SLIDES: Slide[] = [
  {
    kind: "logo",
    title: "Welcome to CT Pickup",
    body: "Competitive pickup soccer across NY, CT, NJ, and MD. Find your run, join the community.",
  },
  {
    kind: "emoji",
    icon: "⚽",
    title: "Find Your Next Run",
    body: "Browse pickup runs in your state. Public runs are open to all approved players — just show up and play.",
  },
  {
    kind: "emoji",
    icon: "🎯",
    title: "Earn Your Invite",
    body: "Select runs are invite-only. Show up consistently, play hard, and you'll get the call.",
  },
  {
    kind: "emoji",
    icon: "⚡",
    title: "Your Reputation Matters",
    body: "Every time you RSVP and show up, your reliability score improves. Cancel last minute and it drops. Consistent players get priority.",
  },
  {
    kind: "emoji",
    icon: "🏆",
    title: "Move Up",
    body: "Show up consistently, perform, and your standing in the community grows over time.",
  },
  {
    kind: "emoji",
    icon: "🥇",
    title: "Compete",
    body: "Claim a team slot, build your roster, and compete. Group stage to knockout.",
  },
  {
    kind: "emoji",
    icon: "🎁",
    title: "Invite Friends, Earn Credits",
    body: "Refer 10 friends and earn a free run credit. Top players each month win free runs and discounts. Stay consistent, stay rewarded.",
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function parseReplayParam(replay: string | string[] | undefined): boolean {
  const raw = Array.isArray(replay) ? replay[0] : replay;
  return raw === "1" || raw === "true";
}

export default function OnboardingScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();
  const { replay } = useLocalSearchParams<{ replay?: string | string[] }>();
  const isReplay = parseReplayParam(replay);

  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finish = useCallback(async () => {
    if (!isReplay) {
      await markOnboardingCompleted();
    }
    if (isReplay && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  }, [isReplay, router]);

  const goNext = useCallback(() => {
    if (isLast) {
      void finish();
      return;
    }
    const next = index + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  }, [finish, index, isLast]);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setIndex(next);
  }, []);

  const renderItem: ListRenderItem<Slide> = useCallback(({ item }) => {
    return (
      <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
        {item.kind === "logo" ? (
          <Image
            source={require("../assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="CT Pickup"
          />
        ) : (
          <Text style={styles.emoji}>{item.icon}</Text>
        )}
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </View>
    );
  }, []);

  if (!isReplay) {
    if (!isReady) {
      return (
        <View style={[styles.screen, styles.center]}>
          <ActivityIndicator size="large" color={themeColor().text} />
        </View>
      );
    }

    if (!session?.user?.email) {
      return <Redirect href="/login" />;
    }

    if (waiverLoading || profileGateLoading) {
      return (
        <View style={[styles.screen, styles.center]}>
          <ActivityIndicator size="large" color={themeColor().text} />
        </View>
      );
    }

    if (!waiverAccepted) {
      return <Redirect href="/waiver" />;
    }

    if (profileNeedsCompletion) {
      return <Redirect href={"/complete-profile" as Href} />;
    }
  }

  return (
    <View style={styles.screen}>
      <Pressable
        style={[styles.skipBtn, { top: insets.top + 8 }]}
        onPress={() => void finish()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Skip"
      >
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: info.index, animated: true });
          }, 80);
        }}
        style={styles.list}
        contentContainerStyle={{ paddingTop: insets.top + 48 }}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        {isLast ? (
          <Pressable
            style={styles.getStartedBtn}
            onPress={() => void finish()}
            accessibilityRole="button"
            accessibilityLabel={isReplay ? "Done" : "Get Started"}
          >
            <Text style={styles.getStartedText}>{isReplay ? "Done" : "Get Started"}</Text>
          </Pressable>
        ) : (
          <View style={styles.nextRow}>
            <View style={{ flex: 1 }} />
            <Pressable style={styles.nextBtn} onPress={goNext} accessibilityRole="button" accessibilityLabel="Next">
              <Text style={styles.nextText}>Next</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: themeColor().bg,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  skipBtn: {
    position: "absolute",
    right: 20,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  skipText: {
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 28,
  },
  emoji: {
    fontSize: 40, fontFamily: "InstrumentSerif_400Regular",
    lineHeight: 84,
    marginBottom: 28,
    textAlign: "center",
  },
  title: {
    color: themeColor().text,
    fontSize: 32, fontFamily: "InstrumentSerif_400Regular",
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 16,
  },
  body: {
    color: themeColor().muted,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 24,
    textAlign: "center",
    maxWidth: 340,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 20,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 10,
    backgroundColor: themeColor().overlayStrong,
  },
  dotActive: {
    backgroundColor: themeColor().pitch,
    width: 22,
  },
  nextRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  nextBtn: {
    backgroundColor: themeColor().pitch,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
    minWidth: 108,
    alignItems: "center",
  },
  nextText: {
    color: themeColor().onPitch,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
  getStartedBtn: {
    backgroundColor: themeColor().pitch,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  getStartedText: {
    color: themeColor().onPitch,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

