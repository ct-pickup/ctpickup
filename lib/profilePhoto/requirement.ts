import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isLegacyMobileClient } from "@/lib/api/appVersion";
import {
  FRIEND_PHOTO_REQUIRED_CODE,
  FRIEND_PHOTO_REQUIRED_MESSAGE,
  hasProfilePhoto,
  PHOTO_REQUIRED_CODE,
  PHOTO_REQUIRED_LEGACY_MESSAGE,
  PHOTO_REQUIRED_MESSAGE,
} from "@/shared/profilePhoto";

/**
 * Vercel env, off by default. Turn on only after 20260405120000_profile_avatar.sql has run in production
 * and a test upload works; otherwise players without a photo could neither join nor upload one.
 */
export const REQUIRE_PROFILE_PHOTO_ENV = "REQUIRE_PROFILE_PHOTO";

export function isProfilePhotoRequired(env: Record<string, string | undefined> = process.env): boolean {
  return (env[REQUIRE_PROFILE_PHOTO_ENV] ?? "").trim().toLowerCase() === "true";
}

/** RSVP states that already hold (or are finishing payment for) a spot; paying for them is never blocked. */
const HELD_SPOT_STATUSES = new Set(["confirmed", "pending_payment", "pending_confirm"]);

export function photoRequiredBody(opts: { legacy: boolean; friend?: boolean }) {
  if (opts.friend) return { error: FRIEND_PHOTO_REQUIRED_MESSAGE, code: FRIEND_PHOTO_REQUIRED_CODE };
  return { error: opts.legacy ? PHOTO_REQUIRED_LEGACY_MESSAGE : PHOTO_REQUIRED_MESSAGE, code: PHOTO_REQUIRED_CODE };
}

/**
 * 403 photo_required when the flag is on and `userId` (the player taking the spot or hosting) has no avatar.
 * `error` carries the friendly message so older clients that alert `error` show it as is.
 * Database errors let the request through: a lookup hiccup must not lock players out.
 */
export async function profilePhotoGate(
  admin: SupabaseClient,
  req: Request,
  opts: { userId: string; runId?: string; friend?: boolean; env?: Record<string, string | undefined> },
): Promise<NextResponse | null> {
  if (!isProfilePhotoRequired(opts.env)) return null;

  const prof = await admin.from("profiles").select("avatar_url").eq("id", opts.userId).maybeSingle();
  if (prof.error) {
    Sentry.captureMessage(`profile photo gate lookup failed: ${prof.error.message}`, {
      level: "warning",
      tags: { area: "profile_photo_gate" },
    });
    return null;
  }
  if (hasProfilePhoto((prof.data as { avatar_url?: string | null } | null)?.avatar_url)) return null;

  if (opts.runId) {
    const rsvp = await admin
      .from("pickup_run_rsvps")
      .select("status")
      .eq("run_id", opts.runId)
      .eq("user_id", opts.userId)
      .maybeSingle();
    const status = (rsvp.data as { status?: string | null } | null)?.status ?? "";
    if (HELD_SPOT_STATUSES.has(status)) return null;
  }

  return NextResponse.json(photoRequiredBody({ legacy: isLegacyMobileClient(req), friend: opts.friend }), {
    status: 403,
  });
}
