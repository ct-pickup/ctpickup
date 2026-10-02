-- ============================================================
-- Phase 4 Part C, step 1: schema check before star ratings.
-- READ-ONLY. Every statement is a SELECT; nothing is written.
-- Run statements one at a time (the Supabase SQL editor only
-- shows the last result of a batch).
-- ============================================================

-- 1. pickup_runs tier/star columns: type, default, nullability.
--    Missing rows mean the column does not exist. Check run_type
--    here before running statement 2a.
select column_name, data_type, udt_name, numeric_precision, numeric_scale,
       column_default, is_nullable, is_generated
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'pickup_runs'
   and column_name in ('tier_session_id', 'tiered_pricing', 'open_tier_rank', 'min_tier',
                       'run_type', 'min_star', 'created_by')
 order by column_name;

-- 2a. open_tier_rank distribution by run_type and host vs admin runs.
--     Informs the later min_star split (host-session skill values
--     1..5 -> 0.5..4.5; open_tier_rank stays wave-only).
--     Only run if statement 1 shows run_type (and created_by).
select run_type,
       (created_by is not null) as host_created,
       open_tier_rank,
       count(*) as runs,
       min(start_at) as first_start,
       max(start_at) as last_start
  from public.pickup_runs
 group by run_type, (created_by is not null), open_tier_rank
 order by run_type, host_created, open_tier_rank nulls first;

-- 2b. Fallback when run_type is missing: open_tier_rank alone.
select open_tier_rank, count(*) as runs
  from public.pickup_runs
 group by open_tier_rank
 order by open_tier_rank nulls first;

-- 3. RLS flags on the rating tables (star_bands is null until step 2 runs).
select c.oid::regclass as table_name, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
 where c.oid in (to_regclass('public.player_ratings'),
                 to_regclass('public.rating_events'),
                 to_regclass('public.star_bands'));

-- 4. Policies on player_ratings (expected: own_rating, select, auth.uid() = user_id).
select policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'player_ratings'
 order by policyname;

-- 5. Table grants on player_ratings and player_cards.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('player_ratings', 'player_cards')
 order by table_name, grantee, privilege_type;

-- 6. Current player_cards definition (expected: user_id, tier, verification,
--    sessions, round(reliability); security_invoker = false).
select pg_get_viewdef('public.player_cards'::regclass, true) as player_cards_def,
       c.reloptions
  from pg_class c
 where c.oid = 'public.player_cards'::regclass;

-- 7. User triggers on player_ratings and rating_events.
select t.tgrelid::regclass as table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid, true) as definition
  from pg_trigger t
 where not t.tgisinternal
   and t.tgrelid in (to_regclass('public.player_ratings'), to_regclass('public.rating_events'))
 order by table_name, t.tgname;

-- 8. Existing functions the star migration touches or depends on.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as returns,
       p.provolatile, p.prosecdef, p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('tier_of', 'star_of', 'settle_session', 'star_hysteresis_margin', 'star_provisional_events')
 order by p.proname, args;

-- 9. player_ratings columns (do star_rating / star_provisional already exist?).
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'player_ratings'
 order by ordinal_position;

-- 10. player_ratings row count and verification / tier mix.
select count(*) as player_ratings_rows,
       count(*) filter (where verification <> 'self') as verified_rows,
       count(*) filter (where reliability < 85) as reliability_below_85,
       min(score) as min_score, max(score) as max_score
  from public.player_ratings;

select tier, verification, count(*) as players
  from public.player_ratings
 group by tier, verification
 order by tier, verification;

-- 11. rating_events per user: how many players would be provisional (< 5 events).
with per_user as (
  select pr.user_id, count(e.id) as events
    from public.player_ratings pr
    left join public.rating_events e on e.user_id = pr.user_id
   group by pr.user_id
)
select count(*) as players,
       count(*) filter (where events = 0) as no_events,
       count(*) filter (where events between 1 and 4) as one_to_four,
       count(*) filter (where events >= 5) as five_or_more,
       max(events) as max_events,
       percentile_cont(0.5) within group (order by events) as median_events
  from per_user;

-- 12. rating_events rows for users without a player_ratings row (should be 0).
select count(*) as orphan_events
  from public.rating_events e
 where not exists (select 1 from public.player_ratings pr where pr.user_id = e.user_id);
