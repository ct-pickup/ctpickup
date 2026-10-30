# Rating v2

Everything here is behind two flags in `app_flags`, both OFF: `rating_v2` and `rating_results`. With both off, ratings work exactly as before. The profile section (Phase D) shows regardless of the flags because it only reads.

## What changes

`settle_session()` picks the engine: when `rating_v2` is on it calls `settle_session_v2()`, otherwise it runs the original body, unchanged. The switch is global (the flag's `enabled` column): a game is settled by one formula whoever triggers it.

### Today's formula (v1)

For each attendee: `delta = k * (w_org * org_signal + (1 - w_org) * vote_signal)`, with `k = 16 * (0.35 + 0.65 * exp(-sessions/6))`, `org_signal = clamp((host score - 5.5) / 4.5)`, `vote_signal = clamp((votes - expected) / expected)`, `expected = max(total votes / attendees, 0.5)`, and `w_org = 0.45 + 0.5 * exp(-sessions/5)` (1.0 when fewer than 60% of attendees voted). Nothing about the other players, every vote counts 1, results are never read.

### v2

1. Field strength. `field_avg` is the average score going in of the other attendees. A gain is multiplied by `exp(-max(score - field_avg, 0) / field_gain_scale)`, which shrinks toward 0 as the player rises above the field. A loss is multiplied by `1 + field_loss_amp * (1 - exp(-max(score - field_avg, 0) / field_loss_scale))`, so a stronger player doing badly against a weaker field loses up to 1.5x.
2. Weighted votes. A vote weighs `score factor x reliability factor x new account factor x repeated pair factor`. Expected votes are recomputed from the weighted total.
3. Host limits. The host score weight is multiplied by `host_pair_decay ^ earlier games of this player under this host in host_pair_days` (not below `host_pair_floor`). The host part can move a player by at most `host_max_share` of k. A host's score for themselves is ignored. With thin turnout the host can still move a player by at most 70% of k (today: all of it).
4. Collusion damping. Each earlier game within `pair_window_days` where the same voter already named the same player multiplies that vote's weight by `pair_decay`, not below `pair_floor`.
5. Distinct evidence. A score cannot rise above `evidence_cap_score` (89.9, below the 4.5 star band) until the player has been rated by at least `evidence_min_hosts` distinct hosts, named by at least `evidence_min_voters` distinct voters, across at least `evidence_min_games` games. A score already above the cap is held, not cut.

### Results (`rating_results`, needs `rating_v2`)

Only a result both teams confirmed counts. Each team's captain, the first player named on the team (earliest team assignment, ties by id, never the game's host), confirms the posted score in the app. Editing the winner, score or number of teams adds 1 to `pickup_run_results.result_version` and clears `verified_at`: confirmation reopens, the earlier confirmations stay as history, and the adjustment the result made is taken back out. Awards edits do not reopen it. Unconfirmed results show on the recap and are ignored by ratings.

`expected = 1 / (1 + exp(-(team average - other team average) / result_scale))`, `result_signal = actual - expected` (win 1, draw 0.5, loss 0), `delta_result = clamp(result_k_share * k * result_signal, +-result_max_delta)`. It is applied after the game is settled, once and idempotently (`apply_result_rating`, ledger `rating_result_adjustments`), whether the confirmation comes before or after the settlement. It does nothing for: unverified results, three-team games, games under `result_min_attendance` attendees, teams differing by more than `result_max_team_diff`, or a player the same host has entered more than `result_host_max_30d` results for in 30 days.

### Profile (Phase D)

`player_game_stats` (server only) holds, per player per settled two-team game, the average score going in of their partners and opponents, the expected and actual result. The view `player_card_stats` exposes record (W-D-L), average partner and opponent as half stars, and performance against expectation: the sum of `result_signal` over the last `profile_perf_games` verified games. It never exposes a raw score.

## Tunable constants

All in `public.rating_config` (one row each, with a note). Change one with `update public.rating_config set value = ... where key = ...;` and the next game settled uses it. The migration never overwrites a value you changed. The TypeScript twin in `lib/rating/ratingMath.ts` has the same defaults; a test fails if they drift apart.

| Key | Start | Meaning |
|---|---|---|
| field_gain_scale | 15 | Points above the field over which gains shrink by e |
| field_loss_amp | 0.5 | Extra loss weight, at most |
| field_loss_scale | 15 | Points over which that builds up |
| vote_score_ref / vote_w_min / vote_w_max | 50 / 0.5 / 1.5 | Voter score factor |
| vote_rel_ref / vote_rel_min | 90 / 0.5 | Voter reliability factor |
| vote_new_sessions / vote_new_floor | 5 / 0.4 | New account factor |
| pair_window_days / pair_decay / pair_floor | 30 / 0.6 / 0.1 | Repeated voter and player pair |
| host_max_share | 0.7 | Most the host score can move a player, as a share of k |
| host_pair_days / host_pair_decay / host_pair_floor | 60 / 0.75 / 0.25 | Repeated host and player pair |
| org_anchor | 0 | 0 = host score read against the middle of the scale (today); 1 = against the player's own score |
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

Then run `scripts/dev/rating_results_backtest_readonly.sql` on production first: it is one SELECT and tells you whether the team average predicts winners and how many results would be eligible, before anything is turned on.

To try it on DEV: set `rating_v2` to enabled in Admin, Feature flags (the app's switch for global flags), settle a test game, read `rating_events` (columns `engine`, `field_avg`, `field_factor`, `host_weight`, `detail`). Then `rating_results`.

The simulator (`node scripts/dev/rating_sim.ts`, results in `docs/rating-v2-simulation.md`) needs no database.
