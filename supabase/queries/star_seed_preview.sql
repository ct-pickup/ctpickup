-- ============================================================
-- Star seed preview (READ-ONLY). Run after migrations
-- 20261005000300_star_levels.sql and 20261005000400_star_seed_functions.sql.
--
-- Lists provisional players (player_ratings.star_provisional, i.e. fewer
-- than star_provisional_events() = 5 rated games in rating_events) with
-- the star the new starting-rating seed would give them.
--
-- Seed level, in order:
--   1. profiles.stated_level (the new "highest level you've played" answer)
--   2. the existing profiles.experience_level, mapped conservatively:
--        pro 5.0, semi_pro 4.0, college 3.5, hs_varsity 3.0, club 3.0,
--        recreational 2.0
--   Players with neither are listed with a null seed and left alone.
-- Unverified players (verification = 'self') are capped at 3.0, the
-- same gate as star_of(). Players already seeded (any rating_seed_log
-- row) are flagged and skipped by star_seed_apply.sql.
--
-- Review the rows, then run supabase/queries/star_seed_apply.sql.
-- ============================================================

with candidates as (
  select pr.user_id,
         trim(concat_ws(' ', p.first_name, p.last_name)) as name,
         p.username,
         (select count(*) from public.rating_events e where e.user_id = pr.user_id) as rated_games,
         pr.star_rating as current_star,
         pr.score as current_score,
         pr.verification::text as verification,
         p.stated_level,
         p.experience_level,
         coalesce(
           p.stated_level,
           case p.experience_level
             when 'pro'          then 5.0
             when 'semi_pro'     then 4.0
             when 'college'      then 3.5
             when 'hs_varsity'   then 3.0
             when 'club'         then 3.0
             when 'recreational' then 2.0
           end
         )::numeric(2,1) as seed_level,
         exists (select 1 from public.rating_seed_log l where l.user_id = pr.user_id) as already_seeded
    from public.player_ratings pr
    join public.profiles p on p.id = pr.user_id
   where pr.star_provisional
),
seeded as (
  select c.*,
         case
           when c.seed_level is null then null
           when c.verification = 'self' then least(c.seed_level, public.star_seed_unverified_cap())
           else c.seed_level
         end as new_star
    from candidates c
)
select s.user_id,
       s.name,
       s.username,
       s.rated_games,
       s.current_star,
       s.verification,
       s.stated_level,
       s.experience_level,
       s.seed_level,
       s.new_star,
       l.name as new_level_name,
       s.current_score,
       public.star_level_seed_score(s.new_star) as new_score,
       s.already_seeded
  from seeded s
  left join public.star_levels l on l.star = s.new_star
 order by s.already_seeded, s.new_star desc nulls last, s.name;
