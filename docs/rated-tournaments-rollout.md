# Rated tournaments: safe rollout

Nothing here is run by the code. Every step is a query or a file you run yourself, in order. Stop at the first step that does not give the answer shown.

## 0. Before anything: read-only checks (change nothing)

Run these four in the SQL editor. They only read.

**0a. Is production running the functions this migration expects?** The migration replaces two functions; its tests compare against the text in this repo.

```sql
select proname, md5(prosrc) as md5
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('apply_result_rating', 'refresh_player_game_stats')
 order by proname;
```

Expected:

| proname | md5 |
|---|---|
| apply_result_rating | `01d2a7828ca5127ec95933ac36520792` |
| refresh_player_game_stats | `2ce8af09cc616461bf3fc167b3b04b0a` |

A different value means production runs something other than `20261101000300` (rating) or `20261101000200` (stats). Stop and send me the output of `select prosrc from pg_proc where proname = '...'`.

**0b. The two triggers whose bodies are not in the repo.** Send me the result so I can read them (they run when a game is inserted or an RSVP changes; the hidden game has no RSVPs, but it is inserted into `pickup_runs`).

```sql
select t.tgname, p.proname, pg_get_functiondef(p.oid) as definition
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where t.tgname in ('trg_ensure_player_rating', 'trg_sync_pickup_runs_legacy_cols') and not t.tgisinternal;
```

**0c. Will a hidden game insert?** Columns that are required and have no default. The migration fills: `title, run_type, is_current, status, start_at, capacity, fee_cents, admin_fee_cents, currency, invite_phase, auto_managed, created_by`. Anything else in the list is a problem.

```sql
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pickup_runs'
   and is_nullable = 'NO' and column_default is null and is_generated = 'NEVER'
 order by 1;

select 'status' as col, enum_range(null::public.pickup_run_status)::text as labels
union all select 'run_type', enum_range(null::public.pickup_run_type)::text;
```

`canceled` must be in the status list and `select` in the run type list.

**0d. The rating switches.** Ratings only move while both are on.

```sql
select key, enabled from public.app_flags where key in ('rating_v2', 'rating_results');
```

## 1. Apply

Apply `20261104000000_tournament_rated_and_match_runs.sql` if it is not already (it is: you said it is applied), then `20261106000000_rated_tournaments.sql`. Do it when no tournament is live and nobody is entering results. It runs in one transaction, so it either all applies or none of it does, and it changes no row of any player.

Deploy the server code before or after: with the migration missing, scoring a rated tournament still saves the score and says "ratings aren't set up yet". With the migration applied and no tournament set to rated, nothing at all changes.

## 2. One query to check it worked

```sql
select (select count(*) from pg_policy where polname = 'tournament_match_runs_hidden' and not polpermissive) = 4
   and (select value from public.rating_config where key = 'tournament_daily_max_delta') = 3
   and to_regclass('public.tournament_rating_days') is not null
   and to_regclass('public.tournament_match_rating') is not null
   and to_regprocedure('public.tournament_sync_match(uuid, uuid)') is not null
   and (select prosrc like '%TOURNAMENT%' from pg_proc where proname = 'apply_result_rating')
   and (select prosrc like '%TOURNAMENT%' from pg_proc where proname = 'refresh_player_game_stats') as ok;
```

`ok` must be `true`. Then sign in as an ordinary player and confirm the Games tab, Home and your profile look the same as before.

## 3. Prove it on a test tournament (consenting test accounts only)

Run `scripts/test-tournament/seed.sql`, then `scripts/test-tournament/rated-demo.sql`, score the two group matches, check the ratings of the 8 players in match 1 moved by about 1 point and match 2 says "too few players", then run `scripts/test-tournament/cleanup.sql` and confirm every rating is back. No real tournament is rated until you switch it on in the admin screen, before its first score.

## 4. Roll back

If step 2 fails, or anything looks wrong later, run `scripts/rollbacks/20261106000000_rated_tournaments_rollback.sql`. It takes every tournament rating change back out first, then removes the hiding policies, puts the two functions back to the exact text of the earlier migrations, and drops what the migration added. One transaction. Safe to run twice. After it, the check below must be `true`:

```sql
select (select count(*) from pg_policy where polname = 'tournament_match_runs_hidden') = 0
   and to_regprocedure('public.tournament_sync_match(uuid, uuid)') is null
   and to_regclass('public.tournament_rating_days') is null
   and (select md5(prosrc) from pg_proc where proname = 'apply_result_rating') = '01d2a7828ca5127ec95933ac36520792'
   and (select md5(prosrc) from pg_proc where proname = 'refresh_player_game_stats') = '2ce8af09cc616461bf3fc167b3b04b0a' as rolled_back;
```
