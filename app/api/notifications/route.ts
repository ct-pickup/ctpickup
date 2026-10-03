import { NextResponse } from "next/server";

import { looksLikeMissingColumn, looksLikeMissingRelation } from "@/lib/match/compatibilityData";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import type { NotificationItem } from "@/shared/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 50;

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function requireUser(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return { admin, userId: null as string | null, error: "Unauthorized" };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.id) return { admin, userId: null as string | null, error: error ? error.message : "Unauthorized" };
  return { admin, userId: data.user.id, error: null as string | null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * GET /api/notifications
 *
 * The player's alerts, newest first. Two real sources: delivered pickup pushes
 * (pickup_push_scheduled with sent_at set), which is all the app records today,
 * and the notifications table once something writes to it. Nothing is invented:
 * if neither has rows the list is empty.
 *
 * Read state is the profiles.notifications_read_at watermark, so an alert is
 * unread when it is newer than the last time the bell was cleared.
 */
export async function GET(req: Request) {
  try {
    const { admin, userId, error } = await requireUser(req);
    if (!userId) return NextResponse.json({ error }, { status: 401 });

    const prof = await admin.from("profiles").select("notifications_read_at").eq("id", userId).maybeSingle();
    const readAtRaw = looksLikeMissingColumn(prof.error ?? undefined, "notifications_read_at")
      ? null
      : ((prof.data as { notifications_read_at?: string | null } | null)?.notifications_read_at ?? null);
    const readAt = readAtRaw ? Date.parse(readAtRaw) : 0;

    const items: NotificationItem[] = [];

    const pushes = await admin
      .from("pickup_push_scheduled")
      .select("id,kind,title,body,data,sent_at")
      .eq("user_id", userId)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(MAX_ITEMS);

    if (!pushes.error) {
      for (const row of pushes.data ?? []) {
        const r = row as { id: string; kind: string; title: string; body: string; data: unknown; sent_at: string };
        items.push({
          id: `push:${r.id}`,
          kind: r.kind,
          title: r.title,
          body: r.body,
          createdAt: r.sent_at,
          data: asRecord(r.data),
          unread: false,
        });
      }
    }

    const feed = await admin
      .from("notifications")
      .select("id,kind,title,body,data,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);

    if (!feed.error) {
      for (const row of feed.data ?? []) {
        const r = row as { id: string; kind: string; title: string; body: string; data: unknown; created_at: string };
        items.push({
          id: `note:${r.id}`,
          kind: r.kind,
          title: r.title,
          body: r.body,
          createdAt: r.created_at,
          data: asRecord(r.data),
          unread: false,
        });
      }
    } else if (!looksLikeMissingRelation(feed.error ?? undefined, "notifications")) {
      return NextResponse.json({ error: "We could not load your notifications right now." }, { status: 500 });
    }

    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const trimmed = items.slice(0, MAX_ITEMS).map((i) => ({ ...i, unread: Date.parse(i.createdAt) > readAt }));
    const unread = trimmed.filter((i) => i.unread).length;

    return NextResponse.json({ items: trimmed, unread }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We could not load your notifications right now." }, { status: 500 });
  }
}

/** POST /api/notifications — marks everything as read by moving the watermark to now. */
export async function POST(req: Request) {
  try {
    const { admin, userId, error } = await requireUser(req);
    if (!userId) return NextResponse.json({ error }, { status: 401 });

    const res = await admin
      .from("profiles")
      .update({ notifications_read_at: new Date().toISOString() })
      .eq("id", userId);

    if (res.error) {
      if (looksLikeMissingColumn(res.error, "notifications_read_at")) {
        return NextResponse.json(
          { error: "Marking as read needs a database update that has not run yet." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "We could not mark those as read." }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We could not mark those as read." }, { status: 500 });
  }
}
