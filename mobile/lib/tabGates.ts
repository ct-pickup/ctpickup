/**
 * Rules for the sign-in gates in app/(tabs)/_layout.tsx (season intro, onboarding).
 *
 * The tabs layout re-checks the gates every time it regains focus (for example when you come back from a screen opened from a
 * card). If that re-check puts up a full-screen spinner, the layout stops rendering <Tabs>, which destroys the tab state: the
 * selected tab, scroll positions and filters are lost and Home is the first tab again. So a re-check only blocks the screen when
 * the gates were NOT already passed.
 */

/** True when the player is through the gates: onboarding done, and no season intro still to show. */
export function gatesPassed(args: { onboardingDone: boolean; seasonEnabled: boolean; seasonIntroNeeded: boolean }): boolean {
  return args.onboardingDone && !(args.seasonEnabled && args.seasonIntroNeeded);
}

/** Whether a gate re-check on focus may cover the screen with a spinner. Never once the gates were passed. */
export function recheckMayBlock(passedBefore: boolean): boolean {
  return !passedBefore;
}
