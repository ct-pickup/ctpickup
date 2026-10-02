import { describe, expect, it } from "vitest";

import {
  describePhotoUploadFailure,
  PHOTO_UPLOAD_FRIENDLY_MESSAGE,
  PhotoUploadError,
  PhotoUserError,
  scrubPhotoErrorDetail,
} from "../shared/photoUploadError";

describe("describePhotoUploadFailure", () => {
  it("shows the friendly message for storage errors and reports the detail", () => {
    const err = new PhotoUploadError("Bucket not found", { status: 400, bucket: "field-photos", path: "u1/field-1.jpg" });
    const out = describePhotoUploadFailure(err, { stage: "upload" });
    expect(out.userMessage).toBe(PHOTO_UPLOAD_FRIENDLY_MESSAGE);
    expect(out.userMessage).not.toMatch(/Bucket|400/);
    expect(out.report?.tags).toEqual({ area: "photo_upload", stage: "upload", bucket: "field-photos" });
    expect(out.report?.extra).toEqual({ status: 400, detail: "Bucket not found", bucket: "field-photos", path: "u1/field-1.jpg" });
    expect(out.report?.message).toBe("Photo upload failed (400): Bucket not found");
  });

  it("keeps user-facing messages and does not report them", () => {
    const out = describePhotoUploadFailure(new PhotoUserError("Please sign in again to upload a photo."), { stage: "upload" });
    expect(out.userMessage).toBe("Please sign in again to upload a photo.");
    expect(out.report).toBeNull();
  });

  it("handles Supabase storage error objects with statusCode", () => {
    const out = describePhotoUploadFailure(
      { message: "Bucket not found", statusCode: "404" },
      { stage: "upload", bucket: "avatars", path: "u1/avatar.jpg" },
    );
    expect(out.userMessage).toBe(PHOTO_UPLOAD_FRIENDLY_MESSAGE);
    expect(out.report?.extra.status).toBe(404);
    expect(out.report?.tags.bucket).toBe("avatars");
  });

  it("handles plain errors and unknown values", () => {
    expect(describePhotoUploadFailure(new Error("Network request failed"), { stage: "save" }).report?.extra.detail).toBe(
      "Network request failed",
    );
    expect(describePhotoUploadFailure("boom", { stage: "remove" }).userMessage).toBe(PHOTO_UPLOAD_FRIENDLY_MESSAGE);
  });
});

describe("scrubPhotoErrorDetail", () => {
  it("removes tokens and caps the length", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
    const out = scrubPhotoErrorDetail(`Bearer ${jwt} failed at /object?token=abc123&x=1 ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("abc123");
    expect(out).toContain("Bearer [redacted]");
    expect(scrubPhotoErrorDetail("x".repeat(500))).toHaveLength(300);
  });
});
