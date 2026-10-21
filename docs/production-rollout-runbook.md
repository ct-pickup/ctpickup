# Production rollout runbook (Fields, remote flags, and the older migrations production is missing)

Production project: `txsagoaqnohdnykweslc`. **Nothing here has been run.** Every step marked 👤 needs you. Everything is ordered so a
stop after any step leaves production consistent. Read `docs/production-drift-check.md` first for how the check works.

## What the drift results mean (and what changed in the repo because of them)

- **`events` collision (fixed in the repo).** `20261012000100_fields_requests_events_slots.sql` used `create table if not exists
  public.events`. Production already has an unrelated `events` table (id, type, title, status, time_option_a/b, locked_time, location_*,
  field_*, goalie_*, lock_rule, created_at; 0 rows) that the existing pages and `lib/pickup/core.ts` read. Run unchanged, that migration
  would: skip the create (the table exists), overwrite that table's comment, then fail at `create index ... events_starts_idx on
  public.events (starts_at)` with `column "starts_at" does not exist`, which aborts and rolls back the whole migration (verified on a
  scratch Postgres). It would have been saved only by statement order: the later `alter table events enable row level security`, `revoke all
  ... from anon, authenticated` and the policy creation (which uses the missing `is_published` column) would have broken the live table.
  The Fields table is now **`public.field_events`** (indexes `field_events_*`, trigger `field_events_touch_updated_at`, policies
  `field_events_select_signed_in` / `field_events_admin_write`). Production's `events` is never touched by any Fields migration, script or
  app code. Dev databases that already have the old table run `scripts/dev/rename_fields_events.sql` once (idempotent, refuses to rename a
  table that lacks the Fields columns; checked: after it, dev has exactly the object names of a fresh run of the new migration).
- **Other name collisions.** None found. I compared every table, view, index, function, trigger, policy, constraint and type the 16 Fields
  migrations create against everything the 128 older migrations create: zero overlaps. The only production tables the repo cannot see are
  the ones created outside migrations (the code reads `avatars, change_requests, event_invites, events, host_ratings,
  pickup_intake_submissions, pickup_run_attendance, pickup_run_availability, pickup_run_invites, pickup_run_rsvps, pickup_run_time_slots,
  pickup_run_updates, pickup_runs, players, rsvps, status_updates, tournament_*, tourney_submissions, training_*`); of those only `events`
  shares a name with a Fields table. The drift check's section B now lists **every** object the Fields migrations create (146 rows, read
  from the migration files) so any other clash shows up before you apply anything.
- **Older migrations out of order.** `20261006100000_instagram_approval_level.sql` is applied in production but its prerequisites
  (`20261005000300`, `20261005000400`: `star_levels`, `star_seed_unverified_cap()`, `star_level_seed_score()`, `rating_seed_log`) are not.
  So `approve_instagram_with_level()` exists and **fails on every call today**: the admin Instagram approval route rolls back and shows
  "unavailable". Applying the star-levels pair fixes that.

## The 7 older migrations (assessment)

| Migration | Changes | Replaces something live players use? | Destructive? | Needed by the new code? | Risk | Recommendation |
|---|---|---|---|---|---|---|
| `20260526120000_pickup_run_wave_schedule_rpc` | Creates `get_pickup_run_wave_schedule(uuid)` and `update_pickup_run_wave_schedule(...)`, service_role only; sends a PostgREST schema reload | No (new functions) | No, additive | Only as a fallback when PostgREST's schema cache misses a wave column (`lib/pickup/pickupRunWavePostgrest.ts`; used by the wave cron and hub promote) | Very low | **Apply** (cheap insurance; the code's error text tells you to) |
| `20260626000000_pickup_credit_amounts` | Replaces `process_profile_referral(uuid)`: the every-10th-referral reward becomes a **$15 credit (1500 cents)** instead of a free run | **Yes.** `process_profile_referral` is called by `trg_profiles_process_referral`, the trigger on `profiles` insert/update, i.e. the signup path | No data change, but a business-rule change | No. New code handles both credit kinds (`lib/pickup/pickupCredits.ts` reads `amount_cents`, null = free run) | Medium: a bug in the new body would fail profile inserts; also changes what players are promised | **Skip for now / apply later** after you decide the reward. Before deciding, read production's current body (query below) |
| `20260729010000_potd_votes` | Table exists; missing are the two indexes. The file also **drops and recreates policies `"attendees can vote"` and `"anyone can read"`** on `potd_votes` and sets a table comment | **Yes, the two policies** (live Player of the Day voting). The file's insert policy only checks `auth.uid() = voter_id`; production's may be stricter | No | No (indexes are performance only) | Low for the indexes; medium if the whole file is run (could loosen a stricter live policy) | **Apply only the two `create index` statements** (step 1.6). Do not run the file unless the policy definitions match |
| `20261002220000_pickup_result_scores_draws` | Adds `pickup_run_results.score_a/score_b`, drops NOT NULL on `winning_team`, adds 3 check constraints, creates `pickup_run_result_edits` (RLS on, no client grants) | No policy or function; relaxes one NOT NULL | No (rollback fails once a draw exists) | **Yes** for scores and draws in the result form (`/api/sessions/result`, `/api/admin/pickup/result`). Without it the routes answer 409 "Scores can't be saved yet" | Low: brief ACCESS EXCLUSIVE lock on a small table while constraints validate | **Apply before the new web/app release** |
| `20261004000000_pickup_runs_time_tbd` | Adds `pickup_runs.time_tbd boolean not null default false` | No | No, instant (metadata only) | Soft: the code degrades (missing column reads as false; extra query per list) but "Time TBD" cannot be saved | Very low | **Apply first** |
| `20261005000300_star_levels` | Creates `star_levels` (+10 seed rows) and `rating_seed_log`; adds `profiles.stated_level(_at)` and `verification_requests.claimed_level/approved_level`; adds trigger `profiles_guard_stated_level` on `profiles` (before insert/update, every row); **drops policy `own_verification` on `verification_requests`, creates read-only `own_verification_read`, and revokes insert/update/delete on `verification_requests` from `authenticated`** | **Yes**: the `verification_requests` policy and grants, and every `profiles` write now runs a trigger | No data lost. It closes a hole (players could update their own request rows). Raises an exception, rolling back, if `star_levels` and `star_bands` row counts differ | **Yes** for the level picker (complete-profile → `/api/account/star-level` returns 503 without it; non-blocking for signup) and for admin level approval | Medium: app builds from before 2026-10-02 whose admin screen updates `verification_requests` directly lose that (players' requests already go through the API) | **Apply, together with the next one**, before the new release |
| `20261005000400_star_seed_functions` | Creates `star_level_seed_score`, `star_seed_unverified_cap`, `seed_star_level_from_signup`, `approve_verification_with_level` (service_role only) | No (new functions); it **makes the already-applied `approve_instagram_with_level` work** | No | **Yes** (same as above) | Low (functions only) | **Apply right after `20261005000300`** |

Do **not** run `supabase/queries/star_seed_apply.sql` as part of this: it rewrites existing players' ratings. Run `star_seed_preview.sql`
(read-only) when you want to, and decide separately.

**Safest order:** `time_tbd` → wave RPC → scores/draws → `star_levels` → `star_seed_functions` → the two potd indexes. The referral
migration waits for a decision. All of them before the Fields migrations, which do not depend on them (Fields needs only
`is_admin_uid`, `auth.users`, `gen_random_uuid()` and `pickup_runs`), but the new web/app release needs them.

---

## 0. Before anything 👤

0.1 **Update the check and read all three sections.** `git pull` on `claude/fields-step1`, `pbcopy < scripts/dev/production_drift_check.sql`,
paste in the **production** SQL Editor, Run. Expect section B all `absent (good)` (146 objects, now including `field_events`, the flags
tables and the policy names), section C `ok` (send me any `MISSING`). Section A should match what you already reported.

0.2 **Connection.** In the dashboard: Project Settings → Database → Connection string → *Session pooler* or *Direct* (not the 6543
transaction pooler: DDL needs a session). Put it in your shell only, never in a file in the repo:
```
export PROD_DB_URL='postgresql://postgres.<ref>:<password>@...:5432/postgres'
export PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=120000'   # a migration gives up in 5 s instead of queueing behind a long transaction
psql "$PROD_DB_URL" -Atc "select current_database(), inet_server_addr(), now()"   # confirm it is production
```
Everywhere below, `psql "$PROD_DB_URL"` is the same as pasting the file in the SQL Editor of project `txsagoaqnohdnykweslc`.

0.3 **Backup.** (a) Dashboard → Database → Backups: confirm a backup from the last 24 h exists, or if Point-in-Time Recovery is on, note
the current time. (b) Take your own dump of the `public` schema and the auth-independent data:
```
pg_dump "$PROD_DB_URL" --schema=public --no-owner --no-privileges -Fc -f ~/prod_public_before_fields_$(date +%Y%m%d_%H%M).dump
ls -lh ~/prod_public_before_fields_*.dump     # must be non-empty
```
(c) Save the definitions the older migrations will change, so you can put them back (read-only; paste the output into a note):
```sql
select 'policy' as kind, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
 where (tablename = 'potd_votes') or (tablename = 'verification_requests') or (tablename = 'pickup_runs' and policyname like '%delete%');
select 'grants' as kind, grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'verification_requests' order by 2, 3, 4;
select proname, pg_get_functiondef(oid) from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('process_profile_referral', 'approve_instagram_with_level', 'profiles_guard_verification');
select tgname, tgenabled from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
```
0.4 **Pick a quiet time** (late night ET). Nothing below needs downtime; the only blocking locks are sub-second on small tables.

0.5 **Deploy order.** Database first (this runbook, steps 1–2), then the web app (Vercel production), then the mobile release. Never the
reverse. Until step 5, keep both flags OFF (they are OFF by default).

---

## 1. The older migrations

For each: run the command, then the verification query, then (only if it failed or you change your mind) the rollback. Files that start
with `begin;` roll back by themselves on error because `psql -v ON_ERROR_STOP=1` stops and the connection closes. Files without `begin;`
use `psql -1` (one transaction). Never pass `-1` for a file that has its own `begin;`/`commit;`.

### 1.1 `20261004000000_pickup_runs_time_tbd.sql` (no `begin;`)
```
psql "$PROD_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261004000000_pickup_runs_time_tbd.sql
```
Verify: `select column_name, data_type, column_default from information_schema.columns where table_name='pickup_runs' and column_name='time_tbd';` → one row, `false`.
Rollback: `alter table public.pickup_runs drop column if exists time_tbd;`

### 1.2 `20260526120000_pickup_run_wave_schedule_rpc.sql` (no `begin;`)
```
psql "$PROD_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20260526120000_pickup_run_wave_schedule_rpc.sql
```
Verify: `select proname, pronargs, prosecdef from pg_proc where proname in ('get_pickup_run_wave_schedule','update_pickup_run_wave_schedule');` → 1 and 9 args, both `prosecdef = true`.
Rollback: `drop function if exists public.get_pickup_run_wave_schedule(uuid); drop function if exists public.update_pickup_run_wave_schedule(uuid, timestamptz, integer, integer, timestamptz, jsonb, timestamptz, timestamptz, boolean);`

### 1.3 `20261002220000_pickup_result_scores_draws.sql` (has `begin;`)
Pre-check (read-only): `select count(*) from public.pickup_run_results where winning_team is null;` → expect 0 (the constraints assume every row has a winner).
```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261002220000_pickup_result_scores_draws.sql
```
Verify: `select column_name, is_nullable from information_schema.columns where table_name='pickup_run_results' and column_name in ('score_a','score_b','winning_team');` → score_a/score_b exist, `winning_team` YES; `select conname from pg_constraint where conname like 'pickup_run_results_%' order by 1;` → includes the 3 new; `select to_regclass('public.pickup_run_result_edits');` → not null.
Rollback: the commented block at the bottom of the file (fails if a draw has been posted).

### 1.4 `20261005000300_star_levels.sql` then `20261005000400_star_seed_functions.sql` 👤 (read the pre-check)
Pre-checks (read-only): `select count(*) from public.star_bands;` → **10** (the migration raises and rolls back otherwise);
`select to_regclass('public.star_levels'), to_regclass('public.rating_seed_log');` → both null;
`select count(*) from public.verification_requests where status = 'pending';` (just to know; pending requests keep working through the API).
```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005000300_star_levels.sql
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005000400_star_seed_functions.sql
```
Verify: `select count(*) from public.star_levels;` → 10; `select policyname from pg_policies where tablename='verification_requests';` → `own_verification_read` only; `select proname from pg_proc where proname in ('star_level_seed_score','star_seed_unverified_cap','seed_star_level_from_signup','approve_verification_with_level') order by 1;` → 4 rows; `select tgname from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_guard_stated_level';` → 1 row. Then in the app (admin): approve a test Instagram request: it should now succeed instead of "unavailable".
Rollback: for `20261005000400`, the commented block in that file (drop the 4 functions); for `20261005000300`, its commented block (drop `rating_seed_log`, restore policy `own_verification` and the grants from the 0.3(c) output, drop the columns and trigger). Roll back `000400` first.

### 1.5 `20260626000000_pickup_credit_amounts.sql` — **SKIP for now** 👤
Decide first whether the 10th-referral reward should become a $15 credit. Read production's current body (query in 0.3(c)). If you decide yes: test it on dev, then `psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -1 -f ...` (no `begin;`), verify `select prosrc like '%1500%' from pg_proc where proname='process_profile_referral';` → true, and watch signups for a day. Rollback: re-run the function from `20260520170000_monthly_player_rewards.sql`.

### 1.6 `20260729010000_potd_votes.sql` — **only the two indexes** (do not run the file)
First compare the live policies with the file's (they will be replaced if you ever run it): see the 0.3(c) output for `potd_votes`. Then:
```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
create index concurrently if not exists potd_votes_run_id_idx on public.potd_votes (run_id);
create index concurrently if not exists potd_votes_nominee_id_idx on public.potd_votes (nominee_id);
SQL
```
(`concurrently` cannot run inside a transaction, so this one is not wrapped; a failure leaves an invalid index: `drop index if exists public.potd_votes_run_id_idx;` and retry.)
Verify: `select indexname from pg_indexes where tablename='potd_votes' order by 1;` → both present, and `select indexrelid::regclass from pg_index where not indisvalid;` → none.

### 1.7 Re-run the drift check 👤
Section A should now read `true` for everything except `20260626000000` (skipped on purpose) and `20260729010000` (`partial` is expected if you did not run the policies; the missing list must be empty of indexes).

---

## 2. Fields migrations (in this order; each has `begin;`)

All additive. They create new objects only; the one change to an existing table is `20261023000000`, which adds two nullable columns and two
indexes to `pickup_runs`. Prerequisites (verify first): `select to_regprocedure('public.is_admin_uid(uuid)'), to_regclass('public.pickup_runs'), to_regclass('public.profiles');` → three non-null, and `select column_name from information_schema.columns where table_name='profiles' and column_name='is_admin';` → 1 row.

```
for f in 20261012000000_fields_venues_schools 20261012000100_fields_requests_events_slots 20261012000200_fields_alerts_saved \
         20261013000000_fields_upsert_preserve_manual 20261013000100_venue_requests_guards 20261014000000_venues_setting \
         20261015000000_plans 20261016000000_plans_v2_season 20261017000000_venues_nearby 20261018000000_venue_suggestions \
         20261019000000_venues_source_manual 20261020000000_locked_field_groups 20261021000000_venue_replies \
         20261022000000_venue_reports 20261023000000_games_at_fields; do
  echo "== $f"; psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql || { echo "STOPPED at $f"; break; }
done
```
Do it as 15 separate runs if you prefer to verify each. The loop stops at the first failure; that migration has rolled back by itself.

| # | Migration | Verify (read-only) | Rollback |
|---|---|---|---|
| 1 | `20261012000000` | `select count(*) from public.venues;` → 0; `select to_regclass('public.schools');` | commented block at the end of the file |
| 2 | `20261012000100` | `select to_regclass('public.field_events'), to_regclass('public.venue_requests'), to_regclass('public.schedule_slots'), to_regclass('public.venue_calendars');` all set, **and** `select count(*) from information_schema.columns where table_name='events' and column_name='starts_at';` → **0** (production's `events` untouched) | commented block (drops `field_events`, not `events`) |
| 3 | `20261012000200` | `select to_regclass('public.saved_venues'), to_regclass('public.alert_subscriptions');` | block in file |
| 4 | `20261013000000` | `select pronargs from pg_proc where proname='upsert_venues';` | re-create from #1 |
| 5 | `20261013000100` | `select indexname from pg_indexes where indexname='venue_requests_one_open_per_slot';` | block in file |
| 6 | `20261014000000` | `select column_default from information_schema.columns where table_name='venues' and column_name='setting';` → `'outdoor'` | block in file |
| 7 | `20261015000000` plans | `select count(*) from public.plan_catalog;` (seeded rows); `select to_regclass('public.plan_subscriptions');` | block in file |
| 8 | `20261016000000` season | `select to_regclass('public.season_purchases');` | block in file |
| 9 | `20261017000000` | `select proname from pg_proc where proname='venues_nearby';` | block in file |
| 10 | `20261018000000` | `select to_regclass('public.venue_suggestions'), to_regclass('public.venue_confirmations');` | block in file |
| 11 | `20261019000000` | `select pg_get_constraintdef(oid) from pg_constraint where conname='venues_source_check';` → includes `manual` | block in file |
| 12 | `20261020000000` | `select proname from pg_proc where proname='upsert_venues';` | re-create from #4 |
| 13 | `20261021000000` | `select to_regclass('public.venue_replies'), to_regclass('public.venue_data_events');` | block in file |
| 14 | `20261022000000` | `select column_name from information_schema.columns where table_name='venues' and column_name in ('status','closed_until','merged_into');` → 3 | block in file |
| 15 | `20261023000000` | `select column_name from information_schema.columns where table_name='pickup_runs' and column_name in ('venue_key','venue_request_id');` → 2 | block in file |

**Remote flags** (still `begin;`), last, because it tightens the insert policies of the tables above:
```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261024000000_app_flags.sql
```
Verify: `select key, enabled, allowlist from public.app_flags order by key;` → `fields` and `paid_plans`, both `false`, empty;
`select public.flag_on('fields', '<an ordinary user id>');` → false; `select public.flag_on('fields', '<your admin id>');` → true.
Rollback: the commented block in the file (it restores the old policies first).

After step 2, re-run the drift check: section B must now read `PRESENT: n` with `n` = the full count for every Fields migration (that is
the expected "applied" state), section A unchanged, section C `ok`.

---

## 3. Web deploy 👤 (Vercel production)

Do this only after step 2. Environment variables (names only; set in Vercel → production): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_SECRET_KEY` (**live**), `STRIPE_WEBHOOK_SECRET`,
`CRON_SECRET`, `GOOGLE_MAPS_API_KEY`, `EXPO_ACCESS_TOKEN`, plus whatever is already set. **Do not add** the plans variables
(`STRIPE_PRICE_SEASON`, `STRIPE_PRICE_CONCIERGE`, `STRIPE_PLANS_WEBHOOK_SECRET`) in production.

> **`paid_plans` must stay OFF in production.** The plans routes accept only an `sk_test_` key (`lib/plans/stripePlans.ts`), while the
> production Stripe runtime (`lib/server/stripeEnv.ts`) rejects test keys. Paid plans cannot work in production until that is redesigned,
> and the flag being off makes `/api/plans/checkout` answer 403 `feature_off`.

Deploy; then verify with a production admin token: `GET /api/admin/flags` → both flags off. Confirm the existing pages that read
production's `events` table (`/run`, `/dm`, pickup creation) still load.

## 4. Venue data import 👤 (production guard)

The importers refuse to write unless the target is explicit. For production you must (1) put the production host in
`CT_PROD_SUPABASE_HOSTS` so it is recognised as production, (2) pass `--allow-prod`, and (3) repeat the host in `--expect-host`.
Always dry-run first (a dry run reads the `venues` table and writes nothing; `import-venues.ts --dry-run` needs no key and no network).

```
export CT_PROD_SUPABASE_HOSTS=txsagoaqnohdnykweslc.supabase.co
export SUPABASE_URL=https://txsagoaqnohdnykweslc.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...      # typed into your shell only; never in the repo or a file

# 4.1 snapshot check (no key, no network)
node --experimental-strip-types scripts/import-venues.ts --db ~/ctpickup-data-backup/venues_snapshot_oct13.db --states CT --dry-run
# 4.2 import one state, repeatable (keeps verified / hand-entered price, booking and permit data)
node --experimental-strip-types scripts/import-venues.ts --db ~/ctpickup-data-backup/venues_snapshot_oct13.db --states CT \
  --expect-host txsagoaqnohdnykweslc.supabase.co --allow-prod
# verify: select count(*), min(state), max(state) from public.venues;  select count(*) from public.schools;
# 4.3 then the other states, one at a time: --states NY, --states NJ, ...
# 4.4 researched rows (dry run first; reads only), then --apply
node --experimental-strip-types scripts/import-research.ts --expect-host txsagoaqnohdnykweslc.supabase.co --allow-prod
node --experimental-strip-types scripts/import-research.ts --expect-host txsagoaqnohdnykweslc.supabase.co --allow-prod --apply
```
Rollback for data: `delete from public.venues where source = 'osm' and state = 'CT';` (only if nobody has requested a field; venue_requests
reference `venue_key`). Researched rows have source `manual`/`research-*` keys and are unverified until you confirm them.
Do **not** run `scripts/dev/*.sql` or `geocode-indoor-venues.mjs` against production.

## 5. Turn it on, slowly 👤

1. Ship the mobile release (TestFlight first; the `testflight-dev` profile points at dev only, so for production use the `production` profile).
2. In the app as an admin: Admin → More → Feature flags. Add yourself and a few testers' emails to **Fields** (allowlist). Nothing changes for anyone else.
3. Test: browse, request a field, report a problem, create a game from a field, as an allowlisted tester and as a non-listed player (they must see exactly what they saw before).
4. Widen: switch **Fields** on for everyone. To stop: switch it off (players lose it on their next foreground, within a minute).
5. Leave **Paid plans** off (see step 3's note).

## 6. If something goes wrong

- Fields misbehaving: switch the flag off (no deploy needed). Data stays.
- A migration failed: it rolled back by itself; nothing else to do; send me the error line.
- A migration succeeded but is wrong: use that migration's rollback; restore from the 0.3 dump only as the last resort
  (`pg_restore` of just the affected table, never the whole schema over live data).
