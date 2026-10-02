/** Eastern time display for tournament kickoff. */
export function formatTournamentStartEt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

/** Tournament `start_at` for player UI, in Eastern time. */
export function formatTournamentStartDisplay(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  const s = String(iso).trim();
  if (!s) return "TBD";
  return formatTournamentStartEt(s);
}
