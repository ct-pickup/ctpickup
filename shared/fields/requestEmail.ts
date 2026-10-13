/** Field request copy shared by the API (push text, stored draft) and the mobile admin screen. No app or server imports. */

export type RequestStatus = "new" | "waiting_on_school" | "approved" | "declined" | "cancelled";
export const ADMIN_SETTABLE_STATUSES = ["waiting_on_school", "approved", "declined"] as const;
export type AdminSettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];

export function isAdminSettableStatus(v: unknown): v is AdminSettableStatus {
  return typeof v === "string" && (ADMIN_SETTABLE_STATUSES as readonly string[]).includes(v);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(h: number, m: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "AM" : "PM";
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** "Sat, Oct 17, 11 AM–1 PM" from a calendar date ("2026-10-17"), a start ("11:00" or "11:00:00") and a length in hours. */
export function formatRequestWhen(date: string, start: string, hours: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, m] = start.split(":").map(Number);
  if (!y || !mo || !d || h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return `${date} ${start}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
  const endMinutes = h * 60 + m + Math.round(hours * 60);
  const endLabel = clock(Math.floor(endMinutes / 60) % 24, endMinutes % 60);
  return `${weekday}, ${MONTHS[mo - 1]} ${d}, ${clock(h, m)}–${endLabel}`;
}

export type DraftEmailInput = {
  venueName: string;
  /** "school" for a school, otherwise "venue". Only changes a few words. */
  venueKind: "school" | "venue";
  date: string;
  start: string;
  hours: number;
  players: number;
};

/** The email the admin sends to the school by hand. Holds no player name or contact details. */
export function draftEmail(i: DraftEmailInput): { subject: string; body: string } {
  const when = formatRequestWhen(i.date, i.start, i.hours);
  const process = i.venueKind === "school" ? "facility-use process" : "booking process";
  return {
    subject: `Field request: ${i.venueName}, ${when}`,
    body:
      `Hello,\n\n` +
      `A local community soccer group would like to request ${i.venueName} on ${when}, about ${i.players} players. ` +
      `Please let us know your ${process}, any fee, and what insurance you need.\n\n` +
      `Thank you,\nCompetitive Together`,
  };
}

/** "Subject\n\nBody" as one string, for the Copy button. */
export function draftEmailText(d: { subject: string; body: string }): string {
  return `Subject: ${d.subject}\n\n${d.body}`;
}

/** mailto: link. `to` may be empty: the mail app opens a compose window and the admin adds the address. */
export function draftMailto(to: string | null | undefined, d: { subject: string; body: string }): string {
  return `mailto:${encodeURIComponent((to ?? "").trim())}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

/** Push text for the player when the admin moves a request. Null for statuses that do not notify. */
export function playerStatusPush(status: RequestStatus, venueName: string, when: string): { title: string; body: string } | null {
  switch (status) {
    case "waiting_on_school":
      return { title: "Request update", body: `We've asked ${venueName} about ${when}. We'll tell you when they reply.` };
    case "approved":
      return { title: "Field approved", body: `${venueName} approved ${when}. You're confirmed.` };
    case "declined":
      return { title: "Request update", body: `${venueName} couldn't offer ${when}. Try another field or time.` };
    default:
      return null;
  }
}

/** Push text for admins when a player sends a request. */
export function adminNewRequestPush(
  playerName: string,
  venueName: string,
  when: string,
  players: number,
  planKind: "free" | "included" | "extra" | null = null,
): { title: string; body: string } {
  const tag = planKind === "extra" ? " · EXTRA request" : planKind === "free" ? " · free first request" : "";
  return { title: "New field request", body: `${playerName} · ${venueName} · ${when} · ${players} players${tag}` };
}
