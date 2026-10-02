import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { siteOrigin } from "@/lib/env";
import { uploadPhoto, type PickedPhoto } from "@/lib/photoUpload";
import { PhotoUploadError, PhotoUserError } from "@shared/photoUploadError";
import {
  AVATAR_BUCKET,
  AVATAR_JPEG_QUALITY,
  AVATAR_PICKER_OPTIONS,
  avatarResize,
  type PhotoReportReason,
} from "@shared/profilePhoto";

export type AvatarSource = "camera" | "library";

/** Opens the camera or library with a square crop. Null if cancelled; PhotoUserError if access is denied. */
export async function pickAvatar(source: AvatarSource): Promise<PickedPhoto | null> {
  if (source === "camera") {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      throw new PhotoUserError("Competitive Together needs camera access to take your photo. You can allow it in Settings.");
    }
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      throw new PhotoUserError("Competitive Together needs photo access to choose your photo. You can allow it in Settings.");
    }
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(AVATAR_PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(AVATAR_PICKER_OPTIONS);
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/** Resizes the square crop to 800px (never upscales) and re-encodes as JPEG 0.8. */
export async function prepareAvatar(photo: PickedPhoto): Promise<string> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const resize = avatarResize(photo.width, photo.height);
  if (resize) ctx.resize(resize);
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: AVATAR_JPEG_QUALITY });
  return saved.uri;
}

/** Uploads to avatars/<userId>/ and sets profiles.avatar_url. Returns the new URL. */
export async function uploadAvatarAndSave(opts: {
  supabase: SupabaseClient;
  userId: string;
  fileUri: string;
  onProgress?: (fraction: number) => void;
}): Promise<string> {
  const { supabase, userId, fileUri, onProgress } = opts;
  const url = await uploadPhoto({ supabase, bucket: AVATAR_BUCKET, userId, fileUri, name: "avatar", onProgress });
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw new PhotoUploadError(`profiles.avatar_url update: ${error.message || error.code || "failed"}`, { bucket: AVATAR_BUCKET });
  return url;
}

export type ProfilePhotoStatus = { required: boolean; hasPhoto: boolean | null; removed: boolean };

/** Server view of the photo requirement. Anything unreadable counts as not required; the server still enforces. */
export async function fetchProfilePhotoStatus(accessToken: string | null): Promise<ProfilePhotoStatus> {
  const fallback: ProfilePhotoStatus = { required: false, hasPhoto: null, removed: false };
  const origin = siteOrigin();
  if (!origin) return fallback;
  try {
    const r = await fetch(`${origin}/api/profile-photo/status`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      cache: "no-store",
    });
    if (!r.ok) return fallback;
    const j = (await r.json().catch(() => null)) as { required?: unknown; has_photo?: unknown; removed?: unknown } | null;
    return {
      required: j?.required === true,
      hasPhoto: typeof j?.has_photo === "boolean" ? j.has_photo : null,
      removed: j?.removed === true,
    };
  } catch {
    return fallback;
  }
}

/** Reports another player's photo. `message` is always safe to show. */
export async function postPhotoReport(
  accessToken: string,
  reportedUserId: string,
  reason: PhotoReportReason | null,
): Promise<{ ok: boolean; already: boolean; message: string }> {
  const origin = siteOrigin();
  const generic = "Couldn't send your report. Try again in a moment.";
  if (!origin) return { ok: false, already: false, message: generic };
  try {
    const r = await fetch(`${origin}/api/profile-photo/report`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reported_user_id: reportedUserId, reason }),
    });
    const j = (await r.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
    if (r.ok) return { ok: true, already: false, message: "Thanks. We'll review this photo." };
    const message = typeof j?.error === "string" && r.status < 500 ? j.error : generic;
    return { ok: false, already: j?.code === "already_reported", message };
  } catch {
    return { ok: false, already: false, message: generic };
  }
}
