/**
 * Required profile photo: picker, resize and copy shared by mobile, web and tests.
 * Pure: no React Native, Next or Sentry imports.
 */

export const AVATAR_BUCKET = "avatars";
export const AVATAR_EDGE = 800;
export const AVATAR_JPEG_QUALITY = 0.8;

/** expo-image-picker options for both camera and library: square crop, full quality (we re-encode after). */
export const AVATAR_PICKER_OPTIONS = {
  mediaTypes: ["images"] as ["images"],
  allowsEditing: true,
  aspect: [1, 1] as [number, number],
  quality: 1,
};

/**
 * Resize for expo-image-manipulator: the square crop scaled to 800px. Never upscales; if the editor
 * returned a non-square image, the longer edge is capped at 800 and the other keeps the ratio.
 */
export function avatarResize(width: number, height: number): { width: number } | { height: number } | null {
  const longEdge = Math.max(width, height);
  if (!Number.isFinite(longEdge) || longEdge <= AVATAR_EDGE) return null;
  return width >= height ? { width: AVATAR_EDGE } : { height: AVATAR_EDGE };
}

export const PHOTO_STEP_TITLE = "Add a photo of you";
export const PHOTO_STEP_BODY = "Use a clear photo of your face. It helps players recognize each other at games.";
export const PHOTO_REMOVED_BODY =
  "Your profile photo was removed after a review. Add a clear photo of your face to keep joining and hosting games.";

export const PHOTO_REQUIRED_CODE = "photo_required";
export const FRIEND_PHOTO_REQUIRED_CODE = "friend_photo_required";
export const PHOTO_REQUIRED_MESSAGE =
  "Add a profile photo before you join or host a game. It helps players recognize each other.";
export const PHOTO_REQUIRED_LEGACY_MESSAGE =
  "Add a profile photo before you join or host a game. Update CT Pickup to the latest version, or add a photo on the CT Pickup website under Profile.";
export const FRIEND_PHOTO_REQUIRED_MESSAGE = "That player needs to add a profile photo before they can join a game.";

export const PHOTO_REPORT_REASONS = [
  { value: "not_them", label: "This isn't them" },
  { value: "inappropriate", label: "Inappropriate" },
  { value: "other", label: "Other" },
] as const;

export type PhotoReportReason = (typeof PHOTO_REPORT_REASONS)[number]["value"];

export function isPhotoReportReason(v: unknown): v is PhotoReportReason {
  return PHOTO_REPORT_REASONS.some((r) => r.value === v);
}

export function hasProfilePhoto(url: string | null | undefined): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

/** Storage path inside the avatars bucket for a public URL we issued, or null for anything else. */
export function avatarStoragePath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at < 0) return null;
  const path = publicUrl.slice(at + marker.length).split("?")[0] ?? "";
  return path && !path.includes("..") ? decodeURIComponent(path) : null;
}
