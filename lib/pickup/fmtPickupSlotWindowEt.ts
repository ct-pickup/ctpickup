const ET_TIME_ZONE = "America/New_York";
const SLOT_WINDOW_MINUTES = 90;

function formatTimeEt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Time TBD";
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    timeZone: ET_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Slot label for voting: "10:00 AM – 11:30 AM ET".
 * (Uses America/New_York wall-clock time for both start and end.)
 */
export function fmtPickupSlotWindowEt(startIso: string | null | undefined): string {
  if (!startIso) return "Time TBD";
  const ms = Date.parse(startIso);
  if (!Number.isFinite(ms)) return "Time TBD";
  const start = new Date(ms).toISOString();
  const end = new Date(ms + SLOT_WINDOW_MINUTES * 60 * 1000).toISOString();
  return `${formatTimeEt(start)} – ${formatTimeEt(end)} ET`;
}

