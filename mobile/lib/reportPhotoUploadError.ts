import * as Sentry from "@sentry/react-native";

import { describePhotoUploadFailure, type PhotoUploadContext } from "@shared/photoUploadError";

/** Sends the technical detail to Sentry (area=photo_upload) and returns the message to show the user. */
export function reportPhotoUploadError(err: unknown, ctx: PhotoUploadContext): string {
  const { userMessage, report } = describePhotoUploadFailure(err, ctx);
  if (report) {
    if (__DEV__) console.warn("[photo_upload]", report.message, report.extra);
    Sentry.captureMessage(report.message, { level: "error", tags: report.tags, extra: report.extra });
  }
  return userMessage;
}
