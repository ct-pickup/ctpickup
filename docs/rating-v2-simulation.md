# Rating simulator results

10 seeds per cell, league of 120 honest players, 40 weeks of burn-in, then 52 weeks with the subject. Hidden true skill T is on the rating scale. Smurf T=85, friend T=30. Everyone starts at 50. Hosts judge a player as 1 + 9*T/100 plus noise, so a host score is an absolute opinion; voters pick the best three others by T plus noise.

Engines: **v1 today**; **v2 Phase B** (fixed references); **v2 Phase F** (expected votes and expected host score from the rating gap; the current settle_session_v2, no field strength factor); **F + field factor (dropped)**: Phase F with the Phase B field strength factor added back at its best setting, to show why it was removed; **F + results**.

## 1. Subjects: what one player's rating does (mean over seeds)

Games to reach a score of 70, 78 (3.5 stars) and 90 (4.5 stars). A run that never gets there counts as 52 in the mean; "never 78" says how many runs that was. Score after 10, 26 and 52 games. Last column: score after 52 games minus true skill T.

| Subject | Engine | to 70 | to 78 | to 90 | never 78 | @10 | @26 | @52 | @52 - T |
|---|---|---|---|---|---|---|---|---|---|
| Honest strong (T=85), mixed games, honest hosts and voters | v1 today | 2.1 | 3.1 | 4.3 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 Phase B | 15.8 | 42.5 | 52.0 | 5/10 | 67.0 | 74.1 | 79.0 | -6.0 |
|  | v2 Phase F (now) | 3.4 | 6.0 | 29.6 | 0/10 | 83.4 | 85.6 | 83.5 | -1.5 |
|  | F + field factor (dropped) | 14.0 | 52.0 | 52.0 | 10/10 | 68.5 | 68.9 | 63.3 | -21.7 |
|  | F + results | 3.5 | 5.8 | 31.3 | 0/10 | 82.8 | 85.0 | 83.0 | -2.0 |
| Smurf (T=85), weak games only, friendly host | v1 today | 2.0 | 2.0 | 3.0 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 53.4 | 56.1 | 58.7 | -26.3 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 41.9 | 41.9 | 42.1 | -42.9 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 35.2 | 34.0 | 32.2 | -52.8 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 42.1 | 42.4 | 42.5 | -42.5 |
| Smurf (T=85), weak games only, friendly host + 3 voters | v1 today | 2.0 | 2.0 | 3.0 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 57.3 | 60.8 | 63.4 | -21.6 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 46.7 | 41.5 | 40.1 | -44.9 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 40.6 | 33.9 | 31.4 | -53.6 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 47.1 | 41.6 | 40.7 | -44.3 |
| Honest weak (T=30), mixed games (control) | v1 today | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 23.4 | 17.6 | 15.3 | -14.7 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 15.3 | 7.0 | 2.0 | -28.0 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 22.8 | 17.2 | 15.4 | -14.6 |
| Weak friend (T=30), colluding host only | v1 today | 2.0 | 3.0 | 5.0 | 0/10 | 98.6 | 94.6 | 84.4 | 54.4 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 4.1 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 31.6 | 19.3 | 12.5 | -17.5 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 23.1 | 8.4 | 0.3 | -29.7 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 30.3 | 18.4 | 11.7 | -18.3 |
| Weak friend (T=30), 3 colluding voters only | v1 today | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 23.4 | 17.6 | 15.3 | -14.7 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 15.3 | 7.0 | 2.0 | -28.0 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 22.8 | 17.2 | 15.4 | -14.6 |
| Weak friend (T=30), colluding host + 3 voters | v1 today | 2.0 | 2.8 | 4.0 | 0/10 | 100.0 | 100.0 | 100.0 | 70.0 |
|  | v2 Phase B | 52.0 | 52.0 | 52.0 | 10/10 | 24.9 | 0.0 | 0.0 | -30.0 |
|  | v2 Phase F (now) | 52.0 | 52.0 | 52.0 | 10/10 | 37.6 | 24.5 | 21.1 | -8.9 |
|  | F + field factor (dropped) | 52.0 | 52.0 | 52.0 | 10/10 | 28.4 | 13.8 | 8.4 | -21.6 |
|  | F + results | 52.0 | 52.0 | 52.0 | 10/10 | 37.3 | 24.7 | 21.4 | -8.6 |

## 2. Honest league: rating error against true skill over time

Everyone honest, 8% no-shows, 120 players starting at 50. RMSE of (score - T) after 10, 26, 52 and 104 weeks, and rank correlation (Spearman) with true skill. Top = players with T >= 75: mean score and mean T.

| Engine | RMSE @10w | @26w | @52w | @104w | rank corr @52w | top mean score | top mean T | highest score |
|---|---|---|---|---|---|---|---|---|
| v1 today | 19.0 | 29.9 | 34.4 | 36.3 | 0.90 | 99.9 | 80.9 | 100.0 |
| v2 Phase B | 16.6 | 26.6 | 30.9 | 33.2 | 0.91 | 99.7 | 80.9 | 100.0 |
| v2 Phase F (now) | 5.2 | 8.4 | 10.4 | 11.6 | 0.99 | 86.6 | 80.9 | 91.3 |
| F + field factor (dropped) | 5.9 | 10.4 | 15.3 | 22.5 | 0.99 | 66.3 | 80.9 | 70.2 |
| F + results | 5.3 | 8.3 | 10.2 | 11.4 | 0.99 | 86.2 | 80.9 | 91.1 |

## 3. No-shows

Honest league, 52 weeks. A no-show costs 7 reliability and the game may fall below 4 players and not count.

| No-show rate | Engine | RMSE @52w | rank corr | mean reliability | mean games played |
|---|---|---|---|---|---|
| 0% | v1 today | 34.9 | 0.88 | 100.0 | 52.0 |
|  | v2 Phase B | 32.0 | 0.89 | 100.0 | 52.0 |
|  | v2 Phase F (now) | 11.9 | 0.99 | 100.0 | 52.0 |
|  | F + field factor (dropped) | 17.8 | 0.99 | 100.0 | 52.0 |
|  | F + results | 11.8 | 0.99 | 100.0 | 52.0 |
| 10% | v1 today | 34.1 | 0.90 | 90.7 | 46.8 |
|  | v2 Phase B | 30.6 | 0.91 | 90.7 | 46.8 |
|  | v2 Phase F (now) | 10.4 | 0.99 | 90.7 | 46.8 |
|  | F + field factor (dropped) | 15.0 | 0.99 | 90.7 | 46.8 |
|  | F + results | 10.3 | 0.99 | 90.7 | 46.8 |
| 25% | v1 today | 32.5 | 0.93 | 40.3 | 39.0 |
|  | v2 Phase B | 27.8 | 0.94 | 40.3 | 39.0 |
|  | v2 Phase F (now) | 7.4 | 0.99 | 40.3 | 39.0 |
|  | F + field factor (dropped) | 10.6 | 0.99 | 40.3 | 39.0 |
|  | F + results | 7.3 | 0.99 | 40.3 | 39.0 |

## 4. Sensitivity of the Phase F constants

6 seeds. One constant changed at a time from the defaults (vote_scale 25, host_scale 20, host_span 5, host_abs_weight 0, host_max_share 0.7). RMSE after 52 weeks in the honest league; games for an honest strong player (T=85) to reach 78 (52 = never); the honest strong and the smurf (friendly host) score after 52 games; the weak friend (T=30) with a colluding host and 3 voters after 26 games.

| Setting | RMSE @52w | honest 85 to 78 | honest 85 @52 | smurf @52 | colluding weak friend @26 |
|---|---|---|---|---|---|
| defaults | 10.1 | 6.2 | 83.6 | 42.9 | 25.0 |
| vote_scale 15 | 5.4 | 16.7 | 72.6 | 40.2 | 34.8 |
| vote_scale 20 | 7.9 | 6.5 | 77.8 | 40.7 | 29.5 |
| vote_scale 30 | 12.0 | 5.8 | 89.1 | 45.7 | 21.1 |
| vote_scale 40 | 15.2 | 5.8 | 97.1 | 51.5 | 13.9 |
| host_scale 10 | 7.8 | 12.5 | 77.3 | 43.6 | 22.1 |
| host_scale 15 | 9.0 | 8.0 | 80.2 | 43.1 | 23.5 |
| host_scale 30 | 11.8 | 4.8 | 89.1 | 42.7 | 27.5 |
| host_scale 45 | 13.5 | 3.7 | 94.1 | 42.0 | 29.7 |
| host_span 3 | 12.8 | 3.8 | 92.8 | 42.4 | 28.9 |
| host_span 4 | 11.3 | 4.8 | 88.0 | 42.8 | 26.9 |
| host_span 6 | 9.2 | 7.7 | 80.2 | 43.0 | 23.6 |
| host_span 7 | 8.5 | 10.0 | 78.2 | 43.1 | 22.7 |
| host_abs_weight 0.3 | 9.5 | 5.0 | 86.8 | 45.8 | 27.7 |
| host_abs_weight 0.6 | 9.2 | 4.7 | 88.1 | 47.5 | 29.2 |
| host_abs_weight 1 | 8.9 | 4.2 | 88.9 | 49.0 | 30.4 |
| host_max_share 0.5 | 10.1 | 6.2 | 83.5 | 42.9 | 24.9 |
