export type ConfirmState = {
  state: "none" | "waiting" | "verified" | "unavailable";
  result: { winning_team: string | null; score_a: number | null; score_b: number | null; total_teams: number } | null;
  confirmed_teams: ("A" | "B")[];
  my_team: "A" | "B" | null;
  can_confirm: boolean;
};

/** The line under the score on the recap. Null when there is nothing to say. */
export function confirmLine(s: ConfirmState): string | null {
  if (s.state === "none" || s.state === "unavailable") return null;
  if (s.state === "verified") return "Confirmed by both teams.";
  if (s.confirmed_teams.length === 1) return `Team ${s.confirmed_teams[0]} confirmed. Waiting for Team ${s.confirmed_teams[0] === "A" ? "B" : "A"}.`;
  return "Waiting for both teams to confirm the score.";
}
