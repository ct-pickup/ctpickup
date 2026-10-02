import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkPersistentRateLimitStrict } from "@/lib/server/persistentRateLimit";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import {
  AVATAR_BUCKET,
  avatarStoragePath,
  hasProfilePhoto,
  isPhotoReportReason,
  type PhotoReportReason,
} from "@/shared/profilePhoto";

export const PHOTO_REPORT_LIMIT = 10;
export const PHOTO_REPORT_WINDOW_SECONDS = 60 * 60;

const UNAVAILABLE = "Reporting isn't available right now. Try again in a moment.";

type Result = { status: number; body: Record<string, unknown> };

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /photo_reports/.test(err.message ?? "");
}

function report(message: string, extra: Record<string, unknown> = {}) {
  Sentry.captureMessage(message, { level: "error", tags: { area: "photo_reports" }, extra });
}

/** Files a report on another player's current photo. Rate limited per reporter (fails closed), one open report per pair. */
export async function createPhotoReport(
  admin: SupabaseClient,
  opts: { reporterId: string; reportedUserId: string; reason: unknown },
): Promise<Result> {
  const { reporterId, reportedUserId } = opts;
  if (reporterId === reportedUserId) {
    return { status: 400, body: { error: "You can't report your own photo." } };
  }
  const reason: PhotoReportReason | null = isPhotoReportReason(opts.reason) ? opts.reason : null;

  const rl = await checkPersistentRateLimitStrict(admin, {
    bucketKey: `photo_report:${reporterId}`,
    limit: PHOTO_REPORT_LIMIT,
    windowSeconds: PHOTO_REPORT_WINDOW_SECONDS,
  });
  if (!rl.ok) {
    if (rl.reason === "limited") {
      return { status: 429, body: { error: "You've sent a lot of reports. Try again later." } };
    }
    report(`photo report rate limit unavailable: ${rl.error}`);
    return { status: 503, body: { error: UNAVAILABLE } };
  }

  const prof = await admin.from("profiles").select("avatar_url").eq("id", reportedUserId).maybeSingle();
  if (prof.error) {
    report(`photo report profile lookup failed: ${prof.error.message}`);
    return { status: 503, body: { error: UNAVAILABLE } };
  }
  if (!prof.data) return { status: 404, body: { error: "Player not found." } };
  const photoUrl = (prof.data as { avatar_url?: string | null }).avatar_url ?? null;
  if (!hasProfilePhoto(photoUrl)) {
    return { status: 409, body: { error: "This player doesn't have a photo to report." } };
  }

  const already = { status: 409, body: { error: "You already reported this photo. We'll review it soon.", code: "already_reported" } };
  const open = await admin
    .from("photo_reports")
    .select("id")
    .eq("reporter_id", reporterId)
    .eq("reported_user_id", reportedUserId)
    .eq("status", "open")
    .maybeSingle();
  if (open.error) {
    report(`photo report lookup failed: ${open.error.message}`, { missing_table: isMissingTable(open.error) });
    return { status: 503, body: { error: UNAVAILABLE } };
  }
  if (open.data) return already;

  const ins = await admin.from("photo_reports").insert({
    reporter_id: reporterId,
    reported_user_id: reportedUserId,
    photo_url: photoUrl,
    reason,
    status: "open",
  });
  if (ins.error) {
    if (ins.error.code === "23505") return already;
    report(`photo report insert failed: ${ins.error.message}`, { missing_table: isMissingTable(ins.error) });
    return { status: 503, body: { error: UNAVAILABLE } };
  }
  return { status: 200, body: { ok: true } };
}

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  photo_url: string | null;
  reason: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function nameOf(p: ProfileRow | undefined): string {
  if (!p) return "Player";
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.username || "Player";
}

/** Open reports grouped by reported player, most reported first, with each player's current photo. */
export async function listOpenPhotoReports(admin: SupabaseClient): Promise<Result> {
  const res = await admin
    .from("photo_reports")
    .select("id,reporter_id,reported_user_id,photo_url,reason,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(500);
  if (res.error) {
    if (isMissingTable(res.error)) return { status: 200, body: { ok: true, groups: [] } };
    report(`photo report list failed: ${res.error.message}`);
    return { status: 500, body: { error: "Couldn't load reports. Try again in a moment." } };
  }
  const rows = (res.data ?? []) as ReportRow[];
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_user_id]))];
  const byId = new Map<string, ProfileRow>();
  if (ids.length) {
    const profs = await admin.from("profiles").select("id,first_name,last_name,username,avatar_url").in("id", ids);
    for (const p of (profs.data ?? []) as ProfileRow[]) byId.set(p.id, p);
  }

  const groups = new Map<string, { user_id: string; name: string; username: string | null; avatar_url: string | null; reports: unknown[] }>();
  for (const r of rows) {
    const subject = byId.get(r.reported_user_id);
    let g = groups.get(r.reported_user_id);
    if (!g) {
      g = {
        user_id: r.reported_user_id,
        name: nameOf(subject),
        username: subject?.username ?? null,
        avatar_url: subject?.avatar_url ?? null,
        reports: [],
      };
      groups.set(r.reported_user_id, g);
    }
    g.reports.push({
      id: r.id,
      reason: r.reason,
      photo_url: r.photo_url,
      created_at: r.created_at,
      reporter_name: nameOf(byId.get(r.reporter_id)),
    });
  }
  const list = [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
  return { status: 200, body: { ok: true, groups: list } };
}

/**
 * Admin decision for every open report on a player. Remove clears profiles.avatar_url, deletes the stored file
 * when it is ours, and tells the player (push now; the app's photo status shows the sheet on next open).
 */
export async function reviewPhotoReports(
  admin: SupabaseClient,
  opts: { adminId: string; userId: string; action: unknown },
): Promise<Result> {
  const { adminId, userId } = opts;
  if (opts.action !== "remove" && opts.action !== "dismiss") {
    return { status: 400, body: { error: "Choose Remove photo or Dismiss." } };
  }
  const now = new Date().toISOString();
  const status = opts.action === "remove" ? "removed" : "dismissed";

  if (opts.action === "remove") {
    const prof = await admin.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
    if (prof.error || !prof.data) {
      if (prof.error) report(`photo remove lookup failed: ${prof.error.message}`);
      return { status: prof.error ? 500 : 404, body: { error: prof.error ? "Couldn't remove the photo. Try again." : "Player not found." } };
    }
    const oldUrl = (prof.data as { avatar_url?: string | null }).avatar_url ?? null;
    const cleared = await admin.from("profiles").update({ avatar_url: null }).eq("id", userId);
    if (cleared.error) {
      report(`photo remove update failed: ${cleared.error.message}`);
      return { status: 500, body: { error: "Couldn't remove the photo. Try again." } };
    }
    const path = avatarStoragePath(oldUrl);
    if (path) {
      try {
        const del = await admin.storage.from(AVATAR_BUCKET).remove([path]);
        if (del.error) report(`photo remove storage delete failed: ${del.error.message}`, { path });
      } catch (e) {
        report(`photo remove storage delete threw: ${e instanceof Error ? e.message : String(e)}`, { path });
      }
    }
  }

  const upd = await admin
    .from("photo_reports")
    .update({ status, reviewed_by: adminId, reviewed_at: now })
    .eq("reported_user_id", userId)
    .eq("status", "open");
  if (upd.error) {
    report(`photo report review update failed: ${upd.error.message}`);
    if (opts.action === "dismiss") return { status: 500, body: { error: "Couldn't update the reports. Try again." } };
  }

  if (opts.action === "remove") {
    try {
      await sendPushToUsers(admin, [userId], {
        title: "Add a new profile photo",
        body: "Your profile photo was removed after a review. Add a clear photo of your face to keep joining games.",
        data: { kind: "photo_removed" },
      });
    } catch (e) {
      report(`photo removed push failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { status: 200, body: { ok: true, status } };
}

/** Whether the player's latest reviewed report removed their photo and they have not added a new one. */
export async function photoWasRemoved(admin: SupabaseClient, userId: string): Promise<boolean> {
  const res = await admin
    .from("photo_reports")
    .select("status,reviewed_at")
    .eq("reported_user_id", userId)
    .eq("status", "removed")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !res.error && !!res.data;
}
