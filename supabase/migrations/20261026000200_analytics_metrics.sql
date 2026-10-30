-- Retention and product metrics, as read-only views over public.analytics_events (and pickup_runs for capacity and start time).
-- Additive and idempotent (create or replace view). No data is changed. Needs 20261026000000_analytics_events.sql first.
--
-- Who can read: the views run with the permissions of the person asking (security_invoker), the table only lets admins read, and
-- the views are not granted to anon or authenticated at all. The admin screens read them through the server with the service role.
--
-- What each view means (all times UTC, weeks start on Monday):
--   analytics_first_game_funnel                 players approved in the last 90 days, and how many of them reached each step afterwards
--   analytics_second_game_30d                   per week of first game: players, and how many played a different game within 30 days
--   analytics_retention_cohorts                 per week of first game: how many played again in each following week (the heatmap)
--   analytics_run_health                        one row per game: joined, waitlisted, cancelled, played, no-shows, fill
--   analytics_run_health_by_region              the same, averaged per region over games in the last 60 days
--   analytics_notification_effectiveness        per push kind, last 30 days: sent, opened, and joined a game within a day
--   analytics_recommendation_effectiveness      per list and reason, last 30 days: shown, tapped, joined that game afterwards
--   analytics_play_again_rate                   per week: players who played, tapped "play with this group again", games created
-- The app-only steps (run_list_viewed, run_viewed, rsvp_started taps, recommendation_*, push_opened) exist only for people who share
-- usage data and only while the 'analytics_client' flag is on, so their counts are lower bounds. Server steps are complete.
--
-- Verify after running (each should return rows or zero rows without an error):
--   select * from public.analytics_first_game_funnel;
--   select * from public.analytics_second_game_30d order by cohort_week desc limit 8;
--   select * from public.analytics_run_health_by_region;
-- Rollback (manual, in this order; no CASCADE needed because nothing depends on these views):
--   drop view if exists public.analytics_play_again_rate;
--   drop view if exists public.analytics_recommendation_effectiveness;
--   drop view if exists public.analytics_notification_effectiveness;
--   drop view if exists public.analytics_run_health_by_region;
--   drop view if exists public.analytics_run_health;
--   drop view if exists public.analytics_retention_cohorts;
--   drop view if exists public.analytics_second_game_30d;
--   drop view if exists public.analytics_first_game_funnel;
--   drop view if exists public.analytics_first_attendance;

-- ---------------------------------------------------------------------------------------------------------------------------
-- A player's first game: the first "attended" event, and the game it was.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_first_attendance with (security_invoker = true) as
select distinct on (user_id)
       user_id,
       occurred_at as first_at,
       run_id      as first_run_id,
       date_trunc('week', occurred_at) as cohort_week
  from public.analytics_events
 where name = 'attended' and user_id is not null
 order by user_id, occurred_at, id;

comment on view public.analytics_first_attendance is 'One row per player: when they first played, which game, and the week that counts as their cohort.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- First-game funnel. Players approved in the last 90 days (account_approved), then how many did each step at or after approval.
-- Steps with no data (the app steps while client analytics is off) show 0; read them only when the step before is above 0.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_first_game_funnel with (security_invoker = true) as
with approved as (
  select user_id, min(occurred_at) as approved_at
    from public.analytics_events
   where name = 'account_approved' and user_id is not null and occurred_at >= now() - interval '90 days'
   group by user_id
),
steps(step_order, step, label, event_name) as (
  values (2, 'run_list_viewed', 'Looked at games', 'run_list_viewed'),
         (3, 'run_viewed',      'Opened a game', 'run_viewed'),
         (4, 'rsvp_started',    'Started to join', 'rsvp_started'),
         (5, 'rsvp_completed',  'Joined a game', 'rsvp_completed'),
         (6, 'attended',        'Played a game', 'attended')
),
reached as (
  select s.step_order, s.step, s.label, count(distinct a.user_id) as players
    from steps s
    join approved a on true
    join public.analytics_events e
      on e.user_id = a.user_id and e.name = s.event_name and e.occurred_at >= a.approved_at
   group by s.step_order, s.step, s.label
)
select 1 as step_order, 'account_approved' as step, 'Approved' as label, (select count(*) from approved) as players
union all
select r.step_order, r.step, r.label, r.players from reached r
union all
select s.step_order, s.step, s.label, 0
  from steps s
 where not exists (select 1 from reached r where r.step = s.step)
 order by step_order;

comment on view public.analytics_first_game_funnel is 'Players approved in the last 90 days and how many reached each later step (looked, opened, started, joined, played). One row per step.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Second game within 30 days, by the week of the first game. "mature" is true once all 30 days have passed, so a young cohort
-- is not mistaken for a bad one. The headline number is the rate over mature cohorts.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_second_game_30d with (security_invoker = true) as
select f.cohort_week::date as cohort_week,
       count(*) as players,
       count(*) filter (where exists (
         select 1 from public.analytics_events e
          where e.user_id = f.user_id and e.name = 'attended'
            and e.occurred_at > f.first_at and e.occurred_at <= f.first_at + interval '30 days'
            and e.run_id is distinct from f.first_run_id
       )) as returned,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.analytics_events e
          where e.user_id = f.user_id and e.name = 'attended'
            and e.occurred_at > f.first_at and e.occurred_at <= f.first_at + interval '30 days'
            and e.run_id is distinct from f.first_run_id
       )) / nullif(count(*), 0), 1) as rate_pct,
       (f.cohort_week + interval '7 days' + interval '30 days') <= now() as mature
  from public.analytics_first_attendance f
 group by f.cohort_week
 order by f.cohort_week;

comment on view public.analytics_second_game_30d is 'Per week of first game: players, how many played a different game within 30 days of their first, the rate, and whether the 30 days are over for everyone in that week.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Retention cohorts: for each week of first game, the share of that cohort who played in week +0, +1, +2 ... (up to +8).
-- Only weeks that have already started are listed, so the heatmap has no empty future cells.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_retention_cohorts with (security_invoker = true) as
with cohort as (
  select cohort_week, count(*) as cohort_size from public.analytics_first_attendance group by cohort_week
),
activity as (
  select f.cohort_week,
         ((date_trunc('week', e.occurred_at)::date - f.cohort_week::date) / 7) as week_offset,
         count(distinct e.user_id) as active
    from public.analytics_first_attendance f
    join public.analytics_events e on e.user_id = f.user_id and e.name = 'attended' and e.occurred_at >= f.first_at
   group by 1, 2
)
select c.cohort_week::date as cohort_week,
       o.week_offset,
       c.cohort_size,
       coalesce(a.active, 0) as active,
       round(100.0 * coalesce(a.active, 0) / nullif(c.cohort_size, 0), 1) as rate_pct
  from cohort c
  cross join generate_series(0, 8) as o(week_offset)
  left join activity a on a.cohort_week = c.cohort_week and a.week_offset = o.week_offset
 where c.cohort_week + (o.week_offset * interval '7 days') <= now()
 order by c.cohort_week, o.week_offset;

comment on view public.analytics_retention_cohorts is 'Heatmap data: per week of first game and weeks since, how many of the cohort played again, as a number and a percent.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Run health: one row per game that has any activity.
--   joined     players who took a spot (rsvp_completed)        left     players who cancelled
--   waitlisted players who joined the waitlist                  played   attended        no_shows  marked no-show
--   fill_pct   (joined - left) over capacity, held between 0 and 100
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_run_health with (security_invoker = true) as
with per_run as (
  select run_id,
         max(region) as region,
         count(distinct user_id) filter (where name = 'rsvp_completed')  as joined,
         count(distinct user_id) filter (where name = 'rsvp_cancelled')  as left_count,
         count(distinct user_id) filter (where name = 'waitlisted')      as waitlisted,
         count(distinct user_id) filter (where name = 'attended')        as played,
         count(distinct user_id) filter (where name = 'no_show')         as no_shows
    from public.analytics_events
   where run_id is not null
     and name in ('rsvp_completed', 'rsvp_cancelled', 'waitlisted', 'attended', 'no_show')
   group by run_id
)
select p.run_id,
       coalesce(p.region, 'unknown') as region,
       r.start_at,
       r.capacity,
       p.joined,
       p.left_count as "left",
       p.waitlisted,
       p.played,
       p.no_shows,
       case when r.capacity > 0
            then round(100.0 * greatest(0, least(r.capacity, p.joined - p.left_count)) / r.capacity, 1) end as fill_pct
  from per_run p
  left join public.pickup_runs r on r.id::text = p.run_id;

comment on view public.analytics_run_health is 'One row per game with activity: joined, left, waitlisted, played, no-shows and how full it got.';

create or replace view public.analytics_run_health_by_region with (security_invoker = true) as
select region,
       count(*) as games,
       round(avg(fill_pct), 1) as avg_fill_pct,
       round(100.0 * count(*) filter (where waitlisted > 0) / nullif(count(*), 0), 1) as games_with_waitlist_pct,
       sum(joined) as joined,
       sum("left") as "left",
       sum(played) as played,
       sum(no_shows) as no_shows,
       round(100.0 * sum(no_shows) / nullif(sum(played) + sum(no_shows), 0), 1) as no_show_pct,
       round(100.0 * sum("left") / nullif(sum(joined), 0), 1) as cancel_pct
  from public.analytics_run_health
 where start_at is not null and start_at <= now() and start_at >= now() - interval '60 days'
 group by region
 order by games desc;

comment on view public.analytics_run_health_by_region is 'Games that started in the last 60 days, per region: average fill, share with a waitlist, no-show and cancel rates.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Notifications: per push kind over the last 30 days. A push counts as opened when the same player opened that push (push_opened with
-- the same push_id). It counts as "joined within a day" when the player took a spot in any game in the 24 hours after it was sent.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_notification_effectiveness with (security_invoker = true) as
with sent as (
  select user_id, occurred_at, properties ->> 'push_id' as push_id, coalesce(properties ->> 'kind', 'other') as kind
    from public.analytics_events
   where name = 'push_sent' and user_id is not null and occurred_at >= now() - interval '30 days'
)
select s.kind,
       count(*) as sent,
       count(*) filter (where exists (
         select 1 from public.analytics_events o
          where o.name = 'push_opened' and o.user_id = s.user_id and o.properties ->> 'push_id' = s.push_id
       )) as opened,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.analytics_events o
          where o.name = 'push_opened' and o.user_id = s.user_id and o.properties ->> 'push_id' = s.push_id
       )) / nullif(count(*), 0), 1) as open_pct,
       count(*) filter (where exists (
         select 1 from public.analytics_events j
          where j.name = 'rsvp_completed' and j.user_id = s.user_id
            and j.occurred_at > s.occurred_at and j.occurred_at <= s.occurred_at + interval '24 hours'
       )) as joined_within_day,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.analytics_events j
          where j.name = 'rsvp_completed' and j.user_id = s.user_id
            and j.occurred_at > s.occurred_at and j.occurred_at <= s.occurred_at + interval '24 hours'
       )) / nullif(count(*), 0), 1) as joined_within_day_pct
  from sent s
 group by s.kind
 order by sent desc;

comment on view public.analytics_notification_effectiveness is 'Per push kind, last 30 days: sent, opened (needs usage data sharing), and joined a game within 24 hours. Opens are a lower bound.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Recommendations ("Best games for you"): per list and reason set, last 30 days. A tap is a recommendation_tapped for the same
-- player and game; "joined" is a rsvp_completed for that player and game after it was shown.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_recommendation_effectiveness with (security_invoker = true) as
with shown as (
  select user_id, run_id, min(occurred_at) as shown_at,
         max(coalesce(properties ->> 'list_kind', 'unknown')) as list_kind,
         max(coalesce(properties ->> 'reasons', 'none')) as reasons
    from public.analytics_events
   where name = 'recommendation_shown' and user_id is not null and run_id is not null
     and occurred_at >= now() - interval '30 days'
   group by user_id, run_id
)
select s.list_kind,
       s.reasons,
       count(*) as shown,
       count(*) filter (where exists (
         select 1 from public.analytics_events t
          where t.name = 'recommendation_tapped' and t.user_id = s.user_id and t.run_id = s.run_id and t.occurred_at >= s.shown_at
       )) as tapped,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.analytics_events t
          where t.name = 'recommendation_tapped' and t.user_id = s.user_id and t.run_id = s.run_id and t.occurred_at >= s.shown_at
       )) / nullif(count(*), 0), 1) as tap_pct,
       count(*) filter (where exists (
         select 1 from public.analytics_events j
          where j.name = 'rsvp_completed' and j.user_id = s.user_id and j.run_id = s.run_id and j.occurred_at >= s.shown_at
       )) as joined,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.analytics_events j
          where j.name = 'rsvp_completed' and j.user_id = s.user_id and j.run_id = s.run_id and j.occurred_at >= s.shown_at
       )) / nullif(count(*), 0), 1) as joined_pct
  from shown s
 group by s.list_kind, s.reasons
 order by shown desc;

comment on view public.analytics_recommendation_effectiveness is 'Per list and reason set, last 30 days: how often a recommended game was shown, tapped, and joined by the same player.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- "Play with this group again": per week, players who played, players who tapped it, games created from it.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.analytics_play_again_rate with (security_invoker = true) as
select w.week::date as week,
       count(distinct e.user_id) filter (where e.name = 'attended') as players,
       count(distinct e.user_id) filter (where e.name = 'play_again_tapped') as tapped,
       count(*) filter (where e.name = 'play_again_created') as games_created,
       round(100.0 * count(distinct e.user_id) filter (where e.name = 'play_again_tapped')
             / nullif(count(distinct e.user_id) filter (where e.name = 'attended'), 0), 1) as tap_pct
  from (select distinct date_trunc('week', occurred_at) as week from public.analytics_events where name in ('attended', 'play_again_tapped', 'play_again_created')) w
  join public.analytics_events e
    on date_trunc('week', e.occurred_at) = w.week and e.name in ('attended', 'play_again_tapped', 'play_again_created')
 group by w.week
 order by w.week;

comment on view public.analytics_play_again_rate is 'Per week: players who played, players who tapped play-with-this-group-again, games created from it, and the tap rate.';

-- Nobody but the server (service role) reads these.
revoke all on public.analytics_first_attendance, public.analytics_first_game_funnel, public.analytics_second_game_30d,
  public.analytics_retention_cohorts, public.analytics_run_health, public.analytics_run_health_by_region,
  public.analytics_notification_effectiveness, public.analytics_recommendation_effectiveness, public.analytics_play_again_rate
  from public, anon, authenticated;
grant select on public.analytics_first_attendance, public.analytics_first_game_funnel, public.analytics_second_game_30d,
  public.analytics_retention_cohorts, public.analytics_run_health, public.analytics_run_health_by_region,
  public.analytics_notification_effectiveness, public.analytics_recommendation_effectiveness, public.analytics_play_again_rate
  to service_role;
