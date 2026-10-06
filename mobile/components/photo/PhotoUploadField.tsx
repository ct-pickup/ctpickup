import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { pickPhoto, preparePhoto, uploadPhoto, type PhotoBucket } from "@/lib/photoUpload";
import { reportPhotoUploadError } from "@/lib/reportPhotoUploadError";
import { themeColor, useThemedStyles } from "@/theme";

import PhotoHeader, { type PhotoAspect } from "./PhotoHeader";

/**
 * Optional photo picker: resize to 1600px JPEG 0.8, upload with progress, and
 * report the public URL. Errors are shown inline and in an alert. With
 * `preview={false}` only the buttons render, for screens that already show the photo.
 */
export default function PhotoUploadField({
  bucket,
  name,
  label,
  hint,
  aspect = "wide",
  preview = true,
  addLabel = "Choose photo",
  value,
  onChange,
  onBusyChange,
}: {
  bucket: PhotoBucket;
  name: string;
  label: string;
  hint?: string;
  aspect?: PhotoAspect;
  preview?: boolean;
  addLabel?: string;
  value: string | null;
  onChange: (url: string | null) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  useThemedStyles(publish_styles);
  const { supabase, session } = useAuth();
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== "idle";

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  async function choose() {
    if (busy) return;
    setError(null);
    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setError("Please sign in again to add a photo.");
      return;
    }
    try {
      const picked = await pickPhoto(aspect === "wide" ? [16, 9] : [4, 3]);
      if (!picked) return;
      setStage("preparing");
      const fileUri = await preparePhoto(picked);
      setStage("uploading");
      setProgress(0);
      const url = await uploadPhoto({ supabase, bucket, userId, fileUri, name, onProgress: setProgress });
      try {
        await onChange(url);
      } catch (e) {
        const message = reportPhotoUploadError(e, { stage: "save", bucket });
        setError(message);
        Alert.alert("Photo not uploaded", message);
      }
    } catch (e) {
      const message = reportPhotoUploadError(e, { stage: "upload", bucket });
      setError(message);
      Alert.alert("Photo not uploaded", message);
    } finally {
      setStage("idle");
    }
  }

  async function remove() {
    if (busy) return;
    setError(null);
    try {
      await onChange(null);
    } catch (e) {
      reportPhotoUploadError(e, { stage: "remove", bucket });
      const message = "Couldn't remove your photo. Try again in a moment.";
      setError(message);
      Alert.alert("Photo not removed", message);
    }
  }

  return (
    <View style={styles.root}>
      {preview ? (
        <>
          <Text style={styles.label}>{label}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}

          <Pressable
            onPress={() => void choose()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={value ? `Change ${label.toLowerCase()}` : label}
            style={styles.frame}
          >
            <PhotoHeader uri={value} aspect={aspect} chalkSize="sm" accessibilityLabel={label} />
          </Pressable>
        </>
      ) : null}

      {busy ? (
        <View style={styles.progressRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={themeColor().pitchText} />
          <Text style={styles.progressText}>
            {stage === "preparing" ? "Preparing photo…" : `Uploading ${Math.round(progress * 100)}%`}
          </Text>
        </View>
      ) : null}
      {stage === "uploading" ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void choose()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.btn, (pressed || busy) && { opacity: 0.6 }]}
        >
          <Text style={styles.btnText}>{value ? "Change photo" : addLabel}</Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={() => void remove()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btnQuiet, (pressed || busy) && { opacity: 0.6 }]}
          >
            <Text style={styles.btnQuietText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { gap: 8 },
    label: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().text },
    hint: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted, lineHeight: 18 },
    frame: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: themeColor().line },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressText: { fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
    track: { height: 4, borderRadius: 2, backgroundColor: themeColor().line, overflow: "hidden" },
    fill: { height: 4, backgroundColor: themeColor().pitch },
    error: { fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().coralText, lineHeight: 18 },
    actions: { flexDirection: "row", gap: 8 },
    btn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: themeColor().pitchText,
    },
    btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().pitchText },
    btnQuiet: { paddingHorizontal: 16, paddingVertical: 8 },
    btnQuietText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
