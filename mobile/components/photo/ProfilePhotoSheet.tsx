import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ProfilePhotoPicker from "@/components/photo/ProfilePhotoPicker";
import { PHOTO_REMOVED_BODY, PHOTO_STEP_BODY, PHOTO_STEP_TITLE } from "@shared/profilePhoto";
import { headline, themeColor, useThemedStyles } from "@/theme";

/** nudge: launch reminder. blocked: tried to join or host. removed: an admin removed the photo after a report. */
export type PhotoSheetReason = "nudge" | "blocked" | "removed";

function bodyFor(reason: PhotoSheetReason): string {
  if (reason === "removed") return PHOTO_REMOVED_BODY;
  if (reason === "blocked") return `Add a photo before you join or host a game. ${PHOTO_STEP_BODY}`;
  return PHOTO_STEP_BODY;
}

export default function ProfilePhotoSheet({
  reason,
  avatarUrl,
  onSaved,
  onClose,
}: {
  reason: PhotoSheetReason | null;
  avatarUrl: string | null;
  onSaved: (url: string) => void;
  onClose: () => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={reason !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Text style={styles.title}>{reason === "removed" ? "Add a new photo" : PHOTO_STEP_TITLE}</Text>
          <Text style={styles.body}>{reason ? bodyFor(reason) : ""}</Text>
          <ProfilePhotoPicker value={avatarUrl} onSaved={onSaved} />
          <Pressable onPress={onClose} style={styles.notNow} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.notNowText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: themeColor().scrim },
    card: {
      backgroundColor: themeColor().bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 24,
      paddingTop: 24,
      gap: 16,
    },
    title: { color: themeColor().text, fontSize: 24, ...headline, textAlign: "center" },
    body: { color: themeColor().muted, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
    notNow: { alignSelf: "center", paddingVertical: 8 },
    notNowText: { color: themeColor().muted, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
