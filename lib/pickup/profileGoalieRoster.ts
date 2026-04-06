/**
 * Informational signals for pickup rosters using `profiles.plays_goalie`.
 * Does not enforce caps — comms / UI only.
 */
export const PROFILE_GOALIE_HEADCOUNT_TARGET = 2;

/** True when there is a confirmed roster but fewer than two players marked willing goalie on their profile. */
export function shouldWarnLowWillingGoalies(
  confirmedPlayerCount: number,
  willingGoalieCount: number,
  minimum: number = PROFILE_GOALIE_HEADCOUNT_TARGET,
): boolean {
  return confirmedPlayerCount > 0 && willingGoalieCount < minimum;
}
