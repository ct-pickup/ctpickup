import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useMemo } from "react";
import { Animated, Modal, PanResponder, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { PRODUCT_NAME } from "@/lib/brand";
import { siteOrigin } from "@/lib/env";
import { hapticTap } from "@/lib/haptics";
import { radius, themeColor, useThemedStyles } from "@/theme";

/** Drag further than this and the sheet closes instead of springing back. */
const DISMISS_DISTANCE = 90;

type CreateMenuSheetProps = {
  visible: boolean;
  onClose: () => void;
  onHostGame: () => void;
  /**
   * Finished game the user hosted with no result yet, or null. When null the
   * "Post a result" row is not shown.
   */
  resultRunId: string | null;
  onPostResult: (runId: string) => void;
};

/**
 * The bottom sheet behind the centre + in the tab bar. Dismissed by dragging down
 * or tapping the backdrop, so it carries no Cancel row.
 */
export function CreateMenuSheet({ visible, onClose, onHostGame, resultRunId, onPostResult }: CreateMenuSheetProps) {
  useThemedStyles(publish_styles);

  const { session } = useAuth();
  const dragY = useMemo(() => new Animated.Value(0), []);

  const close = useCallback(() => {
    dragY.setValue(0);
    onClose();
  }, [dragY, onClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6,
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DISTANCE) close();
          else Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [close, dragY],
  );

  const inviteFriends = useCallback(async () => {
    void hapticTap();
    const origin = siteOrigin();
    const token = session?.access_token;
    let code: string | null = null;

    if (origin && token) {
      try {
        const res = await fetch(`${origin}/api/referral/code`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as { referral_code?: string } | null;
        if (res.ok && typeof json?.referral_code === "string") code = json.referral_code;
      } catch {
        code = null;
      }
    }

    const tail = origin ? ` ${origin}` : "";
    const message = code
      ? `Come play ${PRODUCT_NAME} with me. Enter my referral code ${code} when you sign up.${tail}`
      : `Come play ${PRODUCT_NAME} with me.${tail}`;

    close();
    await Share.share({ message }).catch(() => undefined);
  }, [close, session]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Dismiss menu" />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]} {...pan.panHandlers}>
          <View style={styles.handle} />

          <MenuRow
            icon="plus-circle"
            label="Host a game"
            primary
            onPress={() => {
              void hapticTap();
              close();
              onHostGame();
            }}
          />

          {resultRunId ? (
            <MenuRow
              icon="flag-checkered"
              label="Post a result"
              onPress={() => {
                void hapticTap();
                close();
                onPostResult(resultRunId);
              }}
            />
          ) : null}

          <MenuRow icon="share-alt" label="Invite friends" onPress={() => void inviteFriends()} />
        </Animated.View>
      </View>
    </Modal>
  );
}

function MenuRow(props: {
  icon: React.ComponentProps<typeof FontAwesome>["name"];
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  useThemedStyles(publish_styles);

  const color = props.primary ? themeColor().onAccent : themeColor().text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, props.primary && styles.rowPrimary, pressed && { opacity: 0.9 }]}
    >
      <FontAwesome name={props.icon} size={18} color={color} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: themeColor().overlayStrong },
    sheet: {
      backgroundColor: themeColor().bg,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 28,
      gap: 8,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: themeColor().line,
      marginBottom: 8,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      backgroundColor: themeColor().overlaySubtle,
    },
    rowPrimary: { backgroundColor: themeColor().accent },
    rowIcon: { width: 22, textAlign: "center" },
    rowLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
