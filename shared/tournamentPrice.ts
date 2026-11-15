/**
 * What a tournament captain is charged, in one place. Pure: no React Native, Next, Stripe or Supabase.
 *
 * The Stripe checkout (app/api/stripe/create-checkout-session/route.ts) takes its amount from captainEntryCents(), and every screen
 * that shows a price (the public page, the claim and pay screens in the app and on the website, the admin create form) takes its text
 * from the functions below, so what players and admins read is always the number that is charged. The tournaments.entry_fee_cents
 * column is NOT used for the charge and is not shown anywhere.
 */

/** The price of one player, in cents. */
export const TOURNAMENT_PRICE_PER_PLAYER_CENTS = 5000;
/** The fewest and most players a team is charged for. A smaller or larger claimed team is charged for the nearest of these. */
export const TOURNAMENT_MIN_CHARGED_PLAYERS = 5;
export const TOURNAMENT_MAX_CHARGED_PLAYERS = 25;
/** A claim that names no team size is charged for this many players. */
export const TOURNAMENT_DEFAULT_PLAYERS = 10;

/**
 * How many players a team is charged for, from the team size on its claim (tournament_captains.expected_players). Missing, zero or
 * not a number means the default of 10 (that is what the checkout always did); anything else is held between 5 and 25.
 */
export function chargedPlayers(expectedPlayers: unknown): number {
  const n = Number(expectedPlayers ?? 0) || TOURNAMENT_DEFAULT_PLAYERS;
  return Math.max(TOURNAMENT_MIN_CHARGED_PLAYERS, Math.min(TOURNAMENT_MAX_CHARGED_PLAYERS, n));
}

/** The amount Stripe is asked to charge a captain, in cents. */
export function captainEntryCents(expectedPlayers: unknown): number {
  return chargedPlayers(expectedPlayers) * TOURNAMENT_PRICE_PER_PLAYER_CENTS;
}

/** "$250", "$1,250". Whole dollars only: every price here is a multiple of $50. */
export function formatUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/** The Stripe line item name, kept here so the receipt and the page say the same thing. */
export function checkoutProductName(expectedPlayers: unknown): string {
  return `Competitive Together Tournament Entry — ${chargedPlayers(expectedPlayers)} players × ${formatUsd(TOURNAMENT_PRICE_PER_PLAYER_CENTS)}`;
}

/** "$50 per player". */
export function perPlayerText(): string {
  return `${formatUsd(TOURNAMENT_PRICE_PER_PLAYER_CENTS)} per player`;
}

/** "$250 to $1,250 per team (5 to 25 players)". For a screen that does not know the team size yet. */
export function teamPriceRangeText(): string {
  return `${formatUsd(captainEntryCents(TOURNAMENT_MIN_CHARGED_PLAYERS))} to ${formatUsd(captainEntryCents(TOURNAMENT_MAX_CHARGED_PLAYERS))} per team (${TOURNAMENT_MIN_CHARGED_PLAYERS} to ${TOURNAMENT_MAX_CHARGED_PLAYERS} players)`;
}

/** "$500 for 10 players ($50 per player)". For a screen that knows the team size. */
export function teamTotalText(expectedPlayers: unknown): string {
  const n = chargedPlayers(expectedPlayers);
  return `${formatUsd(captainEntryCents(n))} for ${n} players (${perPlayerText()})`;
}

/** What the pay button says. */
export function payButtonText(expectedPlayers: unknown): string {
  return `Proceed to payment (${formatUsd(captainEntryCents(expectedPlayers))})`;
}

/** What the API tells a screen about the price (see /api/tournament/public). Cents, never text, so every screen words it itself. */
export type TournamentPriceInfo = {
  per_player_cents: number;
  min_players: number;
  max_players: number;
  default_players: number;
};

export function tournamentPriceInfo(): TournamentPriceInfo {
  return {
    per_player_cents: TOURNAMENT_PRICE_PER_PLAYER_CENTS,
    min_players: TOURNAMENT_MIN_CHARGED_PLAYERS,
    max_players: TOURNAMENT_MAX_CHARGED_PLAYERS,
    default_players: TOURNAMENT_DEFAULT_PLAYERS,
  };
}
