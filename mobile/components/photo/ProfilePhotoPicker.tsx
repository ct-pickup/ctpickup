import FontAwesome from "@expo/vector-icons/FontAwesome";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { pickAvatar, prepareAvatar, uploadAvatarAndSave, type AvatarSource } from "@/lib/profilePhoto";
import { reportPhotoUploadError } from "@/lib/reportPhotoUploadError";
import { AVATAR_BUCKET } from "@shared/profilePhoto";
import { themeColor, useThemedStyles } from "@/theme";

/** Round preview plus Take photo / Choose from library. Uploads to the avatars bucket and saves profiles.avatar_url. */
export default function ProfilePhotoPicker({
  value,
  onSaved,
}: {
  value: string | null;
  onSaved: (url: string) => void;
}) {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function choose(source: AvatarSource) {
    if (busy) return;
    setError(null);
    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setError("Please sign in again to add a photo.");
      return;
    }
    let stage: "upload" | "save" = "upload";
    try {
      const picked = await pickAvatar(source);
      if (!picked) return;
      setBusy(true);
      setProgress(0);
      const fileUri = await prepareAvatar(picked);
      const url = await uploadAvatarAndSave({
        supabase,
        userId,
        fileUri,
        onProgress: (f) => {
          setProgress(f);
          if (f >= 1) stage = "save";
        },
      });
      onSaved(url);
    } catch (e) {
      setError(reportPhotoUploadError(e, { stage, bucket: AVATAR_BUCKET }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.preview}>
        {value ? (
          <Image source={{ uri: value }} style={styles.image} accessibilityLabel="Your profile photo" />
        ) : (
          <FontAwesome name="user" size={56} color={themeColor().muted} />
        )}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={themeColor().onPhoto} />
            <Text style={styles.busyText}>{Math.round(progress * 100)}%</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, busy && styles.disabled]}
          onPress={() => void choose("camera")}
          disabled={busy}
          accessibilityRole="button"
        >
          <FontAwesome name="camera" size={14} color={themeColor().onPitch} />
          <Text style={styles.btnPrimaryText}>Take photo</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnOutline, busy && styles.disabled]}
          onPress={() => void choose("library")}
          disabled={busy}
          accessibilityRole="button"
        >
          <FontAwesome name="image" size={14} color={themeColor().accent} />
          <Text style={styles.btnOutlineText}>Choose from library</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>Crop to just you</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const SIZE = 140;

function make_styles() {
  return StyleSheet.create({
    wrap: { alignItems: "center", gap: 16 },
    preview: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      backgroundColor: themeColor().pitchPanel,
      borderWidth: 1,
      borderColor: themeColor().line,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    image: { width: SIZE, height: SIZE },
    busy: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: themeColor().photoScrim,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    busyText: { color: themeColor().onPhoto, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    buttons: { alignSelf: "stretch", gap: 10 },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: 999,
    },
    btnPrimary: { backgroundColor: themeColor().pitch },
    btnPrimaryText: { color: themeColor().onPitch, fontSize: 16, fontFamily: "Inter_700Bold" },
    btnOutline: { borderWidth: 1, borderColor: themeColor().accent },
    btnOutlineText: { color: themeColor().accent, fontSize: 16, fontFamily: "Inter_700Bold" },
    disabled: { opacity: 0.5 },
    hint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    error: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
