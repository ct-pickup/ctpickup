/** Copy for the opt-in women's leaderboard. Pure, so tests can pin the wording. No em dashes, no tier or wave words, never gender data. */
export const WOMENS_SWITCH_LABEL = "Show me on the women's leaderboard";
export const WOMENS_SWITCH_HELP = "Only you choose. Your gender is never shown.";
export const WOMENS_TAB_LABEL = "Women";
export const WOMENS_EMPTY_TITLE = "No one here yet";
export const WOMENS_EMPTY_BODY = "Players can join from Settings. It is always their choice.";
export const WOMENS_SAVE_ERROR = "We couldn't save that. Please try again.";
export const WOMENS_UNAVAILABLE = "This setting isn't available yet.";

/** Message for a failed opt-in or opt-out: "isn't available yet" when the table is missing (migration not applied), else the save error. */
export function womensOptInErrorMessage(err: { message?: string; code?: string } | null | undefined): string {
  const msg = String(err?.message ?? "");
  const missing = err?.code === "42P01" || err?.code === "PGRST205" || /does not exist|schema cache|could not find the table/i.test(msg);
  return missing ? WOMENS_UNAVAILABLE : WOMENS_SAVE_ERROR;
}
