import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { ChalkEmptyState } from "@/components/chalk";
import { useAuth } from "@/context/AuthContext";
import { hapticTap } from "@/lib/haptics";
import { fetchNotifications, markNotificationsRead, NotificationsRequestError } from "@/lib/notificationsApi";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import {
  groupNotifications,
  notificationIcon,
  notificationTarget,
  notificationTime,
  type NotificationItem,
} from "@shared/notifications";

export default function NotificationsScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!token) return;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchNotifications(token);
        setItems(res.items);
      } catch (e) {
        setError(e instanceof NotificationsRequestError ? e.message : "We could not load your notifications right now.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (cancelled) return;
        await load(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const markAll = useCallback(async () => {
    if (!token || marking) return;
    void hapticTap();
    setMarking(true);
    try {
      await markNotificationsRead(token);
      setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
    } catch (e) {
      setError(e instanceof NotificationsRequestError ? e.message : "We could not mark those as read.");
    } finally {
      setMarking(false);
    }
  }, [marking, token]);

  const open = useCallback(
    (item: NotificationItem) => {
      const target = notificationTarget(item.data);
      if (!target) return;
      void hapticTap();
      (router.push as (href: string) => void)(target);
    },
    [router],
  );

  const grouped = groupNotifications(items);
  const anyUnread = items.some((i) => i.unread);

  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={themeColor().muted} />
        }
      >
        {anyUnread ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void markAll()}
            disabled={marking}
            style={({ pressed }) => [styles.markAll, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.markAllText}>{marking ? "Marking as read." : "Mark all as read"}</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={themeColor().muted} />
            <Text style={styles.note}>Loading your alerts.</Text>
          </View>
        ) : items.length === 0 && !error ? (
          <ChalkEmptyState graphic="circle" title="Nothing yet" body="Alerts about your games will show up here." />
        ) : (
          <>
            {grouped.today.length > 0 ? (
              <Section title="Today" items={grouped.today} onPress={open} />
            ) : null}
            {grouped.earlier.length > 0 ? (
              <Section title="Earlier" items={grouped.earlier} onPress={open} />
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function Section({
  title,
  items,
  onPress,
}: {
  title: string;
  items: NotificationItem[];
  onPress: (item: NotificationItem) => void;
}) {
  useThemedStyles(publish_styles);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>
        {items.map((item) => (
          <Row key={item.id} item={item} onPress={() => onPress(item)} />
        ))}
      </View>
    </View>
  );
}

function Row({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  useThemedStyles(publish_styles);

  const tappable = notificationTarget(item.data) != null;
  const icon = notificationIcon(item.kind) as React.ComponentProps<typeof FontAwesome>["name"];

  return (
    <Pressable
      accessibilityRole={tappable ? "button" : "text"}
      accessibilityLabel={`${item.title}. ${item.body}`}
      onPress={tappable ? onPress : undefined}
      disabled={!tappable}
      style={({ pressed }) => [styles.row, pressed && tappable && { opacity: 0.9 }]}
    >
      <View style={styles.iconWrap}>
        <FontAwesome name={icon} size={15} color={themeColor().pitchText} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, item.unread && styles.rowTitleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowTime}>{notificationTime(item.createdAt)}</Text>
        </View>
        {item.body ? (
          <Text style={styles.rowText} numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
      </View>

      {item.unread ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 16, paddingBottom: 40 },
    center: { alignItems: "center", gap: 8, paddingVertical: 32 },
    note: { fontSize: 13, color: c.muted, fontFamily: "Inter_500Medium" },
    error: { fontSize: 13, color: c.text, fontFamily: "Inter_500Medium" },

    markAll: { alignSelf: "flex-end" },
    markAllText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.pitchText },

    section: { gap: 8 },
    sectionTitle: { fontFamily: headline.fontFamily, fontSize: 16, color: c.text },
    group: { borderRadius: radius.card, backgroundColor: c.overlaySubtle, overflow: "hidden" },

    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.overlayStrong,
    },
    rowBody: { flex: 1, gap: 2 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: c.text },
    rowTitleUnread: { fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    rowTime: { fontSize: 11, color: c.muted, fontFamily: "Inter_500Medium" },
    rowText: { fontSize: 13, color: c.muted, fontFamily: "Inter_400Regular" },
    unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: c.accent },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
