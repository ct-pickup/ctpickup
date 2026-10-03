/**
 * Profile badges. Pure: no Supabase, no React. The server computes `earned` (lib/records/playerBadges.ts);
 * the app shows the catalog order, labels and how-to-earn copy from here.
 * Badges only use the player's own record and public facts: never score, tier, reliability or rating math.
 */

export type BadgeId =
  | "first_game"
  | "games_10"
  | "games_25"
  | "games_50"
  | "win_streak_3"
  | "potd"
  | "verified"
  | "hosted"
  | "referral";

export type BadgeDef = { id: BadgeId; label: string; howToEarn: string };

export const BADGES: readonly BadgeDef[] = [
  { id: "first_game", label: "First game", howToEarn: "Play your first pickup game with a posted result." },
  { id: "games_10", label: "10 games", howToEarn: "Play 10 pickup games with posted results." },
  { id: "games_25", label: "25 games", howToEarn: "Play 25 pickup games with posted results." },
  { id: "games_50", label: "50 games", howToEarn: "Play 50 pickup games with posted results." },
  { id: "win_streak_3", label: "3-game win streak", howToEarn: "Win three games in a row. A draw or loss resets the streak." },
  { id: "potd", label: "Player of the Day", howToEarn: "Get picked as Player of the Day in a pickup game." },
  { id: "verified", label: "Verified", howToEarn: "Verify your account from Settings." },
  { id: "hosted", label: "Hosted a game", howToEarn: "Host a pickup game that goes ahead." },
  { id: "referral", label: "Brought a friend", howToEarn: "Invite a friend with your referral code and have them sign up." },
] as const;

export type BadgeStatus = { id: BadgeId; earned: boolean };

export type BadgeInputs = {
  /** Decided games (W, D or L), in any order. */
  games: Array<{ start_at: string | null; outcome: "W" | "D" | "L" | null }>;
  potdCount: number;
  verified: boolean;
  hostedCount: number;
  referralCount: number;
};

/** Longest run of consecutive wins, oldest to newest. Draws and losses reset it; games without a result are skipped. */
export function longestWinStreak(games: BadgeInputs["games"]): number {
  const decided = games
    .filter((g) => g.outcome != null)
    .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")));
  let best = 0;
  let run = 0;
  for (const g of decided) {
    run = g.outcome === "W" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** `verification_level` other than empty or "self" counts as verified, matching the profile chip. */
export function isVerifiedLevel(level: string | null | undefined): boolean {
  const v = (level ?? "").trim();
  return v !== "" && v !== "self";
}

export function computeBadges(inputs: BadgeInputs): BadgeStatus[] {
  const played = inputs.games.filter((g) => g.outcome != null).length;
  const earned: Record<BadgeId, boolean> = {
    first_game: played >= 1,
    games_10: played >= 10,
    games_25: played >= 25,
    games_50: played >= 50,
    win_streak_3: longestWinStreak(inputs.games) >= 3,
    potd: inputs.potdCount >= 1,
    verified: inputs.verified,
    hosted: inputs.hostedCount >= 1,
    referral: inputs.referralCount >= 1,
  };
  return BADGES.map((b) => ({ id: b.id, earned: earned[b.id] }));
}
