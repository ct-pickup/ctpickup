import type { SupabaseClient } from "@supabase/supabase-js";
import { createUploadTask, FileSystemUploadType } from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export type PhotoBucket = "field-photos" | "action-photos";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export type PickedPhoto = { uri: string; width: number; height: number };

/** Opens the photo library. Returns null if the user cancels; throws if access is denied. */
export async function pickPhoto(aspect?: [number, number]): Promise<PickedPhoto | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Photo library access is needed to choose a photo. You can allow it in Settings.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: Boolean(aspect),
    aspect,
    quality: 1,
  });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/** Resizes to a 1600px long edge (never upscales) and re-encodes as JPEG 0.8. */
export async function preparePhoto(photo: PickedPhoto): Promise<string> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const longEdge = Math.max(photo.width, photo.height);
  if (longEdge > MAX_EDGE) {
    ctx.resize(photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return saved.uri;
}

/**
 * Uploads a prepared JPEG into `<bucket>/<userId>/<name>.jpg` and returns its public URL.
 * `onProgress` receives 0..1. Throws with a user-facing message on failure.
 */
export async function uploadPhoto(opts: {
  supabase: SupabaseClient;
  bucket: PhotoBucket;
  userId: string;
  fileUri: string;
  name: string;
  onProgress?: (fraction: number) => void;
}): Promise<string> {
  const { supabase, bucket, userId, fileUri, name, onProgress } = opts;
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!baseUrl || !anonKey) throw new Error("Uploads are not configured in this build.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again to upload a photo.");

  const path = `${userId}/${name}-${Date.now()}.jpg`;
  const task = createUploadTask(
    `${baseUrl}/storage/v1/object/${bucket}/${path}`,
    fileUri,
    {
      httpMethod: "POST",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "image/jpeg",
        "x-upsert": "false",
      },
    },
    (p) => {
      if (p.totalBytesExpectedToSend > 0) {
        onProgress?.(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      }
    },
  );

  const res = await task.uploadAsync();
  if (!res) throw new Error("Upload was cancelled.");
  if (res.status < 200 || res.status >= 300) {
    let detail = "";
    try {
      const body = JSON.parse(res.body) as { message?: string; error?: string };
      detail = body.message || body.error || "";
    } catch {
      detail = res.body?.slice(0, 120) ?? "";
    }
    throw new Error(`Upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  onProgress?.(1);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Field photo URLs keyed by run id. Returns {} if the column is not migrated yet. */
export async function fetchFieldPhotoUrls(
  supabase: SupabaseClient,
  runIds: string[],
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("pickup_runs").select("id,field_photo_url").in("id", ids);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data as Array<{ id: string; field_photo_url: string | null }>) {
    if (row.field_photo_url) out[row.id] = row.field_photo_url;
  }
  return out;
}

/** A profile's action photo URL, or null (also null if the column is not migrated yet). */
export async function fetchActionPhotoUrl(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("action_photo_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { action_photo_url: string | null }).action_photo_url ?? null;
}

/** Sets a run's field photo through the host/admin-checked RPC. */
export async function setRunFieldPhoto(supabase: SupabaseClient, runId: string, url: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_run_field_photo", { p_run_id: runId, p_url: url });
  if (error) throw new Error(error.message || "Could not save the field photo.");
}
