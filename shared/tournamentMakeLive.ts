/**
 * The words on the "Make live" confirm. Pure. The admin app asks the server how many players the push will go to (preview_hub_tournament)
 * and shows this before the real press, so nobody sends a push to thousands of players by tapping through a vague dialog.
 */

export type MakeLivePreview = {
  /** Approved players the "Tournament is live" push is sent to (before each player's own notification settings). */
  recipients: number;
  /** A test tournament (slug starts with test-) sends no push at all. */
  test_tournament: boolean;
};

export function makeLiveConfirmText(title: string, preview: MakeLivePreview | null): string {
  const head = `Set “${title}” as the only live tournament on the hub?`;
  if (!preview) return `${head} The number of players who would get a push could not be worked out. A push is sent to approved players.`;
  if (preview.test_tournament) return `${head} This is a test tournament, so no push is sent.`;
  const n = preview.recipients;
  if (n <= 0) return `${head} No push will be sent (no approved players).`;
  return `${head} This sends a push to ${n.toLocaleString("en-US")} ${n === 1 ? "player" : "players"} (up to: players who turned off tournament notifications or are in quiet hours do not get it).`;
}
