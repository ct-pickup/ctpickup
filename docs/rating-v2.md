# Rating v2

Everything here is behind two flags in `app_flags`, both OFF: `rating_v2` and `rating_results`. With both off, ratings work exactly as before. The profile section (Phase D) shows regardless of the flags because it only reads.

## What changes

`settle_session()` picks the engine: when `rating_v2` is on it calls `settle_session_v2()`, otherwise it runs the original body, unchanged. The switch is global (the flag's `enabled` column): a game is settled by one formula whoever triggers it.

### Today's formula (v1)

For each attendee: `delta = k * (w_org * org_signal + (1 - w_org) * vote_signal)`, with `k = 16 * (0.35 + 0.65 * exp(-sessions/6))`, `org_signal = clamp((host score - 5.5) / 4.5)`, `vote_signal = clamp((votes - expected) / expected)`, `expected = max(total votes / attendees, 0.5)`, and `w_org = 0.45 + 0.5 * exp(-sessions/5)` (1.0 when fewer than 60% of attendees voted). Nothing about the other players, every vote counts 1, results are never read.

### v2 (Phase F: signals anchored to expectation)

For each attendee the game works out what they were *expected* to get, from their rating relative to the other attendees, and rates only the difference.

1. Expected votes. `gap` = the player's score going in minus the average of the others. Expected weighted votes = (all weighted votes in the game) x `exp(gap / vote_scale)` / (the same summed over the game). `vote_signal = clamp((weighted votes received - expected) / average votes per player)`.
2. Expected host score. = what the host gave the other players on average + `host_span` x `tanh(gap / (2 x host_scale))` (blended with `1 + 9 x score / 100` by `host_abs_weight`, default 0). `org_signal = clamp((host score - expected) / host_norm)`. A host who gives everyone 10 moves nobody.

So a player far above the field gains nothing for doing what is expected, loses for falling short, and a weaker player who beats expectation gains. The rest stays: votes are weighted by the voter's score, reliability and age and damped for repeated voter and player pairs; the host part is weighted down for repeat host and player pairings and capped at `host_max_share` of k (a host's score for themselves is ignored); a score cannot pass `evidence_cap_score` (89.9) without `evidence_min_hosts` distinct hosts, `evidence_min_voters` distinct voters and `evidence_min_games` games (a score already above is held, not cut).

The Phase B field strength factor (gains shrink above the field) is gone. In the simulator, adding it back to Phase F kept an honest 85 from ever reaching 78 and raised the error from 10 to 15 (22 after two years), because anchoring already makes "beating a weak field" worth little. `field_gain_scale`, `field_loss_amp`, `field_loss_scale` and `org_anchor` stay in `rating_config` but are no longer read.

### Results (`rating_results`, needs `rating_v2`)

Only a result both teams confirmed counts. Each team's captain, the first player named on the team (earliest team assignment, ties by id, never the game's host), confirms the posted score in the app. Editing the winner, score or number of teams adds 1 to `pickup_run_results.result_version` and clears `verified_at`: confirmation reopens, the earlier confirmations stay as history, and the adjustment the result made is taken back out. Awards edits do not reopen it. Unconfirmed results show on the recap and are ignored by ratings.

`expected = 1 / (1 + exp(-(team average - other team average) / result_scale))`, `result_signal = actual - expected` (win 1, draw 0.5, loss 0), `delta_result = clamp(result_k_share * k * result_signal, +-result_max_delta)`. It is applied after the game is settled, once and idempotently (`apply_result_rating`, ledger `rating_result_adjustments`), whether the confirmation comes before or after the settlement. It does nothing for: unverified results, three-team games, games under `result_min_attendance` attendees, teams differing by more than `result_max_team_diff`, or a player the same account first posted more than `result_host_max_30d` results for in 30 days (counted by `pickup_run_results.posted_by`, the original poster, not `created_by`, which changes with every edit).

### Profile (Phase D)

`player_game_stats` (server only) holds, per player per settled two-team game, the average score going in of their partners and opponents, the expected and actual result. The view `player_card_stats` exposes record (W-D-L), average partner and opponent as half stars, and performance against expectation: the sum of `result_signal` over the last `profile_perf_games` verified games. It never exposes a raw score.

## Tunable constants

All in `public.rating_config` (one row each, with a note; the four Phase B constants above that Phase F no longer reads are left in place). Change one with `update public.rating_config set value = ... where key = ...;` and the next game settled uses it. The migration never overwrites a value you changed. The TypeScript twin in `lib/rating/ratingMath.ts` has the same defaults; a test fails if they drift apart.

| Key | Start | Meaning |
|---|---|---|
| vote_scale | 25 | Points above the field at which a player is expected to draw e times the votes of an average one |
| host_scale | 20 | Points of gap at which the expected host score reaches about 76% of host_span |
| host_span | 5 | Host score points a very large gap is worth |
| host_norm | 4.5 | Host score points that make a full signal |
| host_abs_weight | 0 | 0 = expected host score relative to the others; 1 = from the player's own rating |
| vote_score_ref / vote_w_min / vote_w_max | 50 / 0.5 / 1.5 | Voter score factor |
| vote_rel_ref / vote_rel_min | 90 / 0.5 | Voter reliability factor |
| vote_new_sessions / vote_new_floor | 5 / 0.4 | New account factor |
| pair_window_days / pair_decay / pair_floor | 30 / 0.6 / 0.1 | Repeated voter and player pair |
| host_max_share | 0.7 | Most the host score can move a player, as a share of k |
| host_pair_days / host_pair_decay / host_pair_floor | 60 / 0.75 / 0.25 | Repeated host and player pair |
| evidence_min_hosts / _voters / _games | 3 / 6 / 8 | Distinct evidence for the top bands |
| evidence_cap_score | 89.9 | Ceiling without that evidence |
| result_scale | 12 | Logistic scale, points of team average difference |
| result_k_share | 0.15 | Share of k a result can move a player |
| result_max_delta | 2 | Hard cap per game, points |
| result_min_attendance | 8 | Fewer attendees: no result signal |
| result_max_team_diff | 1 | Uneven teams: no result signal |
| result_host_max_30d | 6 | Results one host entered for one player in 30 days |
| profile_include_unverified | 0 | 1 = profile performance also counts unconfirmed results (display only) |
| profile_perf_games | 20 | Games the performance number sums |
| profile_min_games | 3 | Fewer: "not enough games yet" |

## Rollout (DEV first)

Apply in this order. Each file has a verification query and a rollback at the top.

1. `20261101000000_rating_v2.sql`
2. `20261101000100_rating_results.sql`
3. `20261101000200_player_game_stats.sql` (also backfills the profile table)
4. `20261101000300_rating_v2_expectations.sql` (Phase F: replaces `settle_session_v2` and `apply_result_rating`, adds the new constants and `posted_by`). If you already applied 1 to 3 on DEV, apply only this one.

Then run `scripts/dev/rating_distribution_readonly.sql` (where ratings sit today, how many players hit 100 within five sessions) and `scripts/dev/rating_results_backtest_readonly.sql` on production first. Both are one SELECT: it is one SELECT and tells you whether the team average predicts winners and how many results would be eligible, before anything is turned on.

To try it on DEV: set `rating_v2` to enabled in Admin, Feature flags (the app's switch for global flags), settle a test game, read `rating_events` (columns `engine`, `field_avg`, `host_weight`, `weighted_votes`, and `detail` with `exp_votes`, `exp_host`, `host_part`, `vote_part`). Then `rating_results`.

The simulator (`node scripts/dev/rating_sim.ts`, results in `docs/rating-v2-simulation.md`) needs no database.
