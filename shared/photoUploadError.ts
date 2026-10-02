/**
 * One place that turns photo upload failures into what the user sees and what Sentry gets.
 * Pure: no React Native, Next or Sentry imports, so mobile, web and tests can share it.
 */

export const PHOTO_UPLOAD_FRIENDLY_MESSAGE = "Couldn't upload your photo. Try again in a moment.";

export type PhotoUploadStage = "upload" | "save" | "remove";

/** Technical context for a failure. Never put image bytes, URIs of local files, or tokens here. */
export type PhotoUploadContext = {
  stage: PhotoUploadStage;
  bucket?: string;
  path?: string;
  status?: number;
};

/** A failure whose message is already written for the user (permission denied, signed out). Not reported. */
export class PhotoUserError extends Error {
  readonly userFacing = true;
}

/** A storage or network failure carrying the raw detail for Sentry. Its message is always the friendly one. */
export class PhotoUploadError extends Error {
  readonly status?: number;
  readonly detail: string;
  readonly bucket?: string;
  readonly path?: string;

  constructor(detail: string, opts: { status?: number; bucket?: string; path?: string } = {}) {
    super(PHOTO_UPLOAD_FRIENDLY_MESSAGE);
    this.name = "PhotoUploadError";
    this.detail = detail;
    this.status = opts.status;
    this.bucket = opts.bucket;
    this.path = opts.path;
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+\S+/gi;
const KEY_PARAM_RE = /([?&](?:token|apikey|key|signature)=)[^&\s]+/gi;

/** Strips anything token-shaped and caps the length. */
export function scrubPhotoErrorDetail(raw: string): string {
  return raw
    .replace(JWT_RE, "[redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(KEY_PARAM_RE, "$1[redacted]")
    .slice(0, 300);
}

function rawDetail(err: unknown): { message: string; status?: number } {
  if (err instanceof PhotoUploadError) return { message: err.detail, status: err.status };
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; status?: unknown; statusCode?: unknown; error?: unknown };
    const message = typeof o.message === "string" ? o.message : typeof o.error === "string" ? o.error : String(err);
    const statusRaw = o.status ?? o.statusCode;
    const status = typeof statusRaw === "number" ? statusRaw : typeof statusRaw === "string" ? Number(statusRaw) || undefined : undefined;
    return { message, status };
  }
  return { message: String(err) };
}

export type PhotoUploadFailure = {
  userMessage: string;
  /** Null when the error is user-facing and needs no report. */
  report: {
    message: string;
    tags: { area: "photo_upload"; stage: PhotoUploadStage; bucket: string };
    extra: { status: number | null; detail: string; bucket: string | null; path: string | null };
  } | null;
};

export function describePhotoUploadFailure(err: unknown, ctx: PhotoUploadContext): PhotoUploadFailure {
  if (err instanceof PhotoUserError) return { userMessage: err.message, report: null };
  const { message, status } = rawDetail(err);
  const detail = scrubPhotoErrorDetail(message);
  const finalStatus = ctx.status ?? status;
  const bucket = ctx.bucket ?? (err instanceof PhotoUploadError ? err.bucket : undefined);
  const path = ctx.path ?? (err instanceof PhotoUploadError ? err.path : undefined);
  return {
    userMessage: PHOTO_UPLOAD_FRIENDLY_MESSAGE,
    report: {
      message: `Photo ${ctx.stage} failed${finalStatus ? ` (${finalStatus})` : ""}: ${detail}`,
      tags: { area: "photo_upload", stage: ctx.stage, bucket: bucket ?? "unknown" },
      extra: { status: finalStatus ?? null, detail, bucket: bucket ?? null, path: path ?? null },
    },
  };
}
