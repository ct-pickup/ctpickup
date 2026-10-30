# Rating simulator results

10 seeds per cell, league of 120 honest players, 40 weeks of burn-in, then 52 weeks with the subject. Hidden true skill T is on the rating scale. Smurf T=85, friend T=30. Everyone starts at 50.

## 1. Smurf and collusion: what a subject's rating does (mean over seeds)

Games to reach a score of 70, 78 (3.5 stars) and 90 (4.5 stars). A run that never gets there counts as 52 in the mean; the "never reach 78" column says how many of the runs that was. Score after 10, 26 and 52 games. Last column: score after 52 games minus true skill T.

| Subject | Engine | to 70 | to 78 | to 90 | never reach 78 | @10 | @26 | @52 | final - T |
|---|---|---|---|---|---|---|---|---|---|
| Honest strong (T=85), mixed games, honest hosts and voters | v1 | 2.1 | 3.1 | 4.3 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 | 15.8 | 42.5 | 52.0 | 5/10 | 67.0 | 74.1 | 79.0 | -6.0 |
|  | v2r | 19.0 | 44.0 | 52.0 | 6/10 | 66.2 | 72.3 | 76.9 | -8.1 |
|  | v2a | 15.5 | 45.1 | 52.0 | 5/10 | 67.0 | 73.7 | 78.6 | -6.4 |
| Smurf (T=85), weak games only, friendly host | v1 | 2.0 | 2.0 | 3.0 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 53.4 | 56.1 | 58.7 | -26.3 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 52.8 | 55.2 | 57.1 | -27.9 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 54.0 | 57.1 | 60.2 | -24.8 |
| Smurf (T=85), weak games only, friendly host + 3 voters | v1 | 2.0 | 2.0 | 3.0 | 0/10 | 100.0 | 100.0 | 100.0 | 15.0 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 57.3 | 60.8 | 63.4 | -21.6 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 57.6 | 60.0 | 62.6 | -22.4 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 57.9 | 61.8 | 64.6 | -20.4 |
| Honest weak (T=30), mixed games (control) | v1 | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 0.1 | 0.2 | 0.0 | -30.0 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 6.6 | 0.0 | 0.0 | -30.0 |
| Weak friend (T=30), colluding host only | v1 | 2.0 | 3.0 | 5.0 | 0/10 | 98.6 | 94.6 | 84.4 | 54.4 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 4.1 | 0.0 | 0.0 | -30.0 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 2.0 | 0.1 | 0.1 | -29.9 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 4.8 | 0.0 | 0.0 | -30.0 |
| Weak friend (T=30), 3 colluding voters only | v1 | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 0.0 | 0.0 | 0.0 | -30.0 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 0.1 | 0.2 | 0.0 | -30.0 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 6.6 | 0.0 | 0.0 | -30.0 |
| Weak friend (T=30), colluding host + 3 voters | v1 | 2.0 | 2.8 | 4.0 | 0/10 | 100.0 | 100.0 | 100.0 | 70.0 |
|  | v2 | 52.0 | 52.0 | 52.0 | 10/10 | 24.9 | 0.0 | 0.0 | -30.0 |
|  | v2r | 52.0 | 52.0 | 52.0 | 10/10 | 23.5 | 0.3 | 0.2 | -29.8 |
|  | v2a | 52.0 | 52.0 | 52.0 | 10/10 | 25.0 | 0.0 | 0.0 | -30.0 |

## 2. Honest league: rating error against true skill

Everyone honest, 8% no-shows. RMSE of (score - T) and rank correlation (Spearman) with true skill. Top = players with T >= 75: their mean score and mean T.

| Engine | RMSE @26w | RMSE @52w | RMSE @104w | rank corr @52w | top mean score | top mean T | highest score |
|---|---|---|---|---|---|---|---|
| v1 | 29.9 | 34.4 | 36.3 | 0.90 | 99.9 | 80.9 | 100.0 |
| v2 | 26.6 | 30.9 | 33.2 | 0.91 | 99.7 | 80.9 | 100.0 |
| v2r | 26.4 | 30.7 | 33.0 | 0.91 | 99.2 | 80.9 | 100.0 |
| v2a | 18.8 | 23.2 | 24.6 | 0.98 | 95.6 | 80.9 | 99.7 |

## 3. No-shows

Honest league, 52 weeks. A no-show costs 7 reliability and the game may fall below 4 players and not count.

| No-show rate | Engine | RMSE @52w | rank corr | mean reliability | mean games played |
|---|---|---|---|---|---|
| 0% | v1 | 34.9 | 0.88 | 100.0 | 52.0 |
|  | v2 | 32.0 | 0.89 | 100.0 | 52.0 |
|  | v2r | 31.7 | 0.90 | 100.0 | 52.0 |
|  | v2a | 24.8 | 0.97 | 100.0 | 52.0 |
| 10% | v1 | 34.1 | 0.90 | 90.7 | 46.8 |
|  | v2 | 30.6 | 0.91 | 90.7 | 46.8 |
|  | v2r | 30.5 | 0.91 | 90.7 | 46.8 |
|  | v2a | 23.2 | 0.97 | 90.7 | 46.8 |
| 25% | v1 | 32.5 | 0.93 | 40.3 | 39.0 |
|  | v2 | 27.8 | 0.94 | 40.3 | 39.0 |
|  | v2r | 27.5 | 0.94 | 40.3 | 39.0 |
|  | v2a | 18.9 | 0.98 | 40.3 | 39.0 |

## 4. Sensitivity: how fast the field factor bites (v2, field_gain_scale)

Larger scale = gains shrink more slowly as a player rises above the field. Honest strong player (T=85) in mixed games against the smurf in weak games with a friendly host. Score after 26 and 52 games, mean over seeds.

| field_gain_scale | honest strong @26 | honest strong @52 | smurf @26 | smurf @52 | gap @52 |
|---|---|---|---|---|---|
| 10 | 63.2 | 66.0 | 51.3 | 52.0 | 13.9 |
| 15 (default) | 74.1 | 79.0 | 56.1 | 58.7 | 20.3 |
| 25 | 91.1 | 98.8 | 68.8 | 75.3 | 23.5 |
| 40 | 100.0 | 100.0 | 86.0 | 89.9 | 10.1 |
| 80 | 100.0 | 100.0 | 89.9 | 89.9 | 10.1 |
