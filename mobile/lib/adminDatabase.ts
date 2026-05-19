import { siteOrigin } from "@/lib/env";
import type { AdminApiResult } from "@/lib/adminApi";

export const ADMIN_DB_TABLE_KEYS = [
  "runs",
  "invites",
  "rsvps",
  "results",
  "attendance",
  "tournaments",
  "roster",
  "tournament_payments",
  "matches",
  "mvp_votes",
  "profiles",
  "reports",
  "blocks",
  "follows",
  "push_devices",
  "rooms",
  "messages",
  "reactions",
  "chat_reports",
  "platform_payments",
] as const;

export type AdminDbTableKey = (typeof ADMIN_DB_TABLE_KEYS)[number];

export type AdminDbSectionSummary = {
  total_count: number;
  last_updated: string | null;
};

export type AdminDbOverviewResponse = {
  sections: Record<AdminDbTableKey, AdminDbSectionSummary>;
};

export type AdminDbTableResponse = {
  table: AdminDbTableKey;
  total_count: number;
  last_updated: string | null;
  records: Record<string, unknown>[];
};

export type AdminDbSectionDef = {
  key: AdminDbTableKey;
  title: string;
  emoji: string;
  group: "pickup" | "tournaments" | "players" | "chat" | "payments";
};

export const ADMIN_DB_SECTIONS: AdminDbSectionDef[] = [
  { key: "runs", title: "Pickup Runs", emoji: "⚽", group: "pickup" },
  { key: "invites", title: "Run Invites", emoji: "✉️", group: "pickup" },
  { key: "rsvps", title: "RSVPs", emoji: "✅", group: "pickup" },
  { key: "results", title: "Run Results", emoji: "🏆", group: "pickup" },
  { key: "attendance", title: "Run Attendance", emoji: "📋", group: "pickup" },
  { key: "tournaments", title: "Tournaments", emoji: "🎯", group: "tournaments" },
  { key: "roster", title: "Tournament Roster", emoji: "👥", group: "tournaments" },
  { key: "tournament_payments", title: "Tournament Payments", emoji: "💳", group: "tournaments" },
  { key: "matches", title: "Tournament Matches", emoji: "⚔️", group: "tournaments" },
  { key: "mvp_votes", title: "MVP Votes", emoji: "⭐", group: "tournaments" },
  { key: "profiles", title: "Profiles", emoji: "🧑", group: "players" },
  { key: "reports", title: "Player Reports", emoji: "🚩", group: "players" },
  { key: "blocks", title: "Player Blocks", emoji: "🚫", group: "players" },
  { key: "follows", title: "Player Follows", emoji: "🔗", group: "players" },
  { key: "push_devices", title: "Push Devices", emoji: "📱", group: "players" },
  { key: "rooms", title: "Chat Rooms", emoji: "💬", group: "chat" },
  { key: "messages", title: "Chat Messages", emoji: "📝", group: "chat" },
  { key: "reactions", title: "Chat Reactions", emoji: "😀", group: "chat" },
  { key: "chat_reports", title: "Chat Reports", emoji: "⚠️", group: "chat" },
  { key: "platform_payments", title: "Platform Payments", emoji: "💰", group: "payments" },
];

export const ADMIN_DB_GROUP_LABELS: Record<AdminDbSectionDef["group"], string> = {
  pickup: "PICKUP",
  tournaments: "TOURNAMENTS",
  players: "PLAYERS",
  chat: "CHAT",
  payments: "PAYMENTS",
};

async function adminDbFetch<T>(path: string, accessToken: string): Promise<AdminApiResult<T>> {
  const origin = siteOrigin();
  if (!origin) {
    return { ok: false, status: 0, error: "missing_site_url" };
  }
  let r: Response;
  try {
    r = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg || "Network error" };
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const err =
      j && typeof j === "object" && typeof (j as { error?: string }).error === "string"
        ? (j as { error: string }).error
        : `HTTP ${r.status}`;
    return { ok: false, status: r.status, error: err, detail: j };
  }
  return { ok: true, status: r.status, data: j as T };
}

export function fetchAdminDatabaseOverview(accessToken: string) {
  return adminDbFetch<AdminDbOverviewResponse>("/api/admin/database", accessToken);
}

export function fetchAdminDatabaseTable(accessToken: string, table: AdminDbTableKey) {
  return adminDbFetch<AdminDbTableResponse>(`/api/admin/database?table=${encodeURIComponent(table)}`, accessToken);
}

export function formatAdminDbRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatAdminDbCount(n: number): string {
  return `${n.toLocaleString("en-US")} record${n === 1 ? "" : "s"}`;
}

/** Status badge colors for admin database rows. */
export type StatusBadgeStyle = {
  bg: string;
  border: string;
  text: string;
};

export function statusBadgeStyle(status: string | null | undefined): StatusBadgeStyle {
  const s = String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (
    s === "planning" ||
    s === "pending" ||
    s === "checkout_started" ||
    s === "invited" ||
    s === "pending_confirm"
  ) {
    return { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.2)", text: "rgba(255,255,255,0.75)" };
  }
  if (
    s === "active" ||
    s === "confirmed" ||
    s === "payment_received" ||
    s === "accepted" ||
    s === "likely_on" ||
    s === "succeeded" ||
    s === "in_progress"
  ) {
    return { bg: "rgba(163,230,53,0.18)", border: "rgba(163,230,53,0.45)", text: "#a3e635" };
  }
  if (s === "completed" || s === "fulfillment_succeeded") {
    return { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)", text: "#86efac" };
  }
  if (s === "canceled" || s === "cancelled" || s === "declined" || s === "rejected" || s === "payment_failed") {
    return { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", text: "#f87171" };
  }
  if (s === "waitlist" || s === "standby") {
    return { bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.4)", text: "#93c5fd" };
  }
  if (s === "pending_payment") {
    return { bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.45)", text: "#fbbf24" };
  }

  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.15)", text: "rgba(255,255,255,0.6)" };
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function shortId(v: unknown, len = 8): string {
  const s = str(v);
  if (!s) return "—";
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

function fmtMoneyCents(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function fmtDt(iso: unknown): string {
  const t = str(iso);
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatProfilePlayerName(first: unknown, last: unknown): string {
  const name = [str(first), str(last)].filter(Boolean).join(" ");
  return name || "Unknown";
}

/** Primary status field per table for badge display. */
export function recordStatusField(table: AdminDbTableKey, row: Record<string, unknown>): string | null {
  if (table === "attendance") {
    return row.attended === true ? "confirmed" : row.attended === false ? "declined" : null;
  }
  if (table === "tournaments") {
    if (row.canceled_at) return "canceled";
    return row.is_active === true ? "active" : "planning";
  }
  const status = str(row.status);
  if (status) return status;
  const lifecycle = str(row.lifecycle_status);
  if (lifecycle) return lifecycle;
  return null;
}

/** Human-readable lines for list rows (title + subtitle). */
export function formatAdminDbRecordSummary(
  table: AdminDbTableKey,
  row: Record<string, unknown>,
): { title: string; subtitle: string; status: string | null; playerName?: string } {
  switch (table) {
    case "runs":
      return {
        title: str(row.title) || "Pickup run",
        subtitle: [str(row.run_type), str(row.service_region), fmtDt(row.start_at)].filter(Boolean).join(" · "),
        status: recordStatusField(table, row),
      };
    case "invites":
      return {
        title: `User ${shortId(row.user_id)}`,
        subtitle: `Run ${shortId(row.run_id)} · ${fmtDt(row.invited_at)}`,
        status: "invited",
      };
    case "rsvps":
      return {
        title: `User ${shortId(row.user_id)}`,
        subtitle: `Run ${shortId(row.run_id)} · ${fmtDt(row.updated_at || row.created_at)}`,
        status: recordStatusField(table, row),
      };
    case "results":
      return {
        title: `Run ${shortId(row.run_id)} · Team ${str(row.winning_team)}`,
        subtitle: `${row.total_teams ?? "?"} teams · ${fmtDt(row.created_at)}`,
        status: "completed",
      };
    case "attendance":
      return {
        title: `User ${shortId(row.user_id)}`,
        subtitle: `Run ${shortId(row.run_id)}`,
        status: recordStatusField(table, row),
      };
    case "tournaments":
      return {
        title: str(row.title) || "Tournament",
        subtitle: [str(row.service_region), str(row.venue), fmtDt(row.start_at)].filter(Boolean).join(" · "),
        status: recordStatusField(table, row),
      };
    case "roster":
      return {
        title: `Player ${shortId(row.user_id)}`,
        subtitle: `Tournament ${shortId(row.tournament_id)} · ${fmtDt(row.invited_at)}`,
        status: recordStatusField(table, row),
      };
    case "tournament_payments":
      return {
        title: fmtMoneyCents(row.amount_cents),
        subtitle: `Captain ${shortId(row.captain_id)} · ${str(row.method)}`,
        status: recordStatusField(table, row),
      };
    case "matches":
      return {
        title: `Match #${row.match_number ?? "?"} · ${str(row.stage) || "stage"}`,
        subtitle: [
          str(row.group_name),
          row.score_a != null && row.score_b != null ? `${row.score_a}-${row.score_b}` : null,
          fmtDt(row.completed_at),
        ]
          .filter(Boolean)
          .join(" · "),
        status: row.winner_id || row.completed_at ? "completed" : "active",
      };
    case "mvp_votes":
      return {
        title: str(row.voted_for_name) || "MVP vote",
        subtitle: `Match ${shortId(row.match_id)} · ${fmtDt(row.created_at)}`,
        status: "confirmed",
      };
    case "profiles": {
      const name = [row.first_name, row.last_name].map(str).filter(Boolean).join(" ");
      return {
        title: name || str(row.username) || shortId(row.id),
        subtitle: [str(row.tier), str(row.nearest_venue), str(row.instagram)].filter(Boolean).join(" · "),
        status: row.is_banned === true ? "canceled" : "confirmed",
      };
    }
    case "reports":
      return {
        title: `Report: ${str(row.reason)}`,
        subtitle: `Reported ${shortId(row.reported_user_id)} · ${fmtDt(row.created_at)}`,
        status: "pending",
      };
    case "blocks":
      return {
        title: `${shortId(row.blocker_user_id)} → ${shortId(row.blocked_user_id)}`,
        subtitle: fmtDt(row.created_at),
        status: "active",
      };
    case "follows":
      return {
        title: `${shortId(row.follower_id)} follows ${shortId(row.following_id)}`,
        subtitle: fmtDt(row.created_at),
        status: "confirmed",
      };
    case "push_devices":
      return {
        title: str(row.platform) || "device",
        subtitle: `User ${shortId(row.user_id)} · ${formatAdminDbRelativeTime(str(row.updated_at))}`,
        status: "active",
      };
    case "rooms":
      return {
        title: str(row.title) || str(row.slug) || "Room",
        subtitle: [str(row.room_type), row.is_active === false ? "inactive" : "active"].filter(Boolean).join(" · "),
        status: row.is_active === false ? "canceled" : "active",
      };
    case "messages": {
      const body = str(row.body);
      return {
        title: body.length > 72 ? `${body.slice(0, 72)}…` : body || "Message",
        subtitle: `Room ${shortId(row.room_id)} · ${fmtDt(row.created_at)}`,
        status: row.sender_is_admin === true ? "active" : "confirmed",
      };
    }
    case "reactions":
      return {
        title: `${str(row.emoji)} reaction`,
        subtitle: `Msg ${shortId(row.message_id)} · ${fmtDt(row.created_at)}`,
        status: "confirmed",
      };
    case "chat_reports":
      return {
        title: `Report: ${str(row.reason)}`,
        subtitle: `Msg ${shortId(row.message_id)} · ${fmtDt(row.created_at)}`,
        status: "pending",
      };
    case "platform_payments":
      return {
        title: str(row.title) || str(row.product_type) || "Payment",
        playerName: formatProfilePlayerName(row.first_name, row.last_name),
        subtitle: `${fmtMoneyCents(row.amount_cents)} · ${str(row.product_type)} · ${fmtDt(row.created_at)}`,
        status: recordStatusField(table, row) || str(row.fulfillment_status),
      };
    default:
      return { title: shortId(row.id), subtitle: "", status: null };
  }
}

export function recordMatchesSearch(table: AdminDbTableKey, row: Record<string, unknown>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { title, subtitle, status, playerName } = formatAdminDbRecordSummary(table, row);
  const blob = [title, subtitle, status, playerName, JSON.stringify(row)].join(" ").toLowerCase();
  return blob.includes(q);
}
