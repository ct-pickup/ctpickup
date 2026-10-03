-- ============================================================
-- Star seed apply (WRITES). One-off, run by hand AFTER reviewing
-- supabase/queries/star_seed_preview.sql. Uses exactly the same rules:
--
--   * provisional players only (player_ratings.star_provisional);
--   * seed level = profiles.stated_level, else the mapped
--     profiles.experience_level (pro 5.0, semi_pro 4.0, college 3.5,
--     hs_varsity 3.0, club 3.0, recreational 2.0);
--   * unverified ('self') capped at 3.0;
--   * players with any rating_seed_log row are skipped, so re-running
--     is a no-op for anyone already seeded;
--   * score = star_level_seed_score(new star), the band midpoint. The
--     player_ratings_set_star trigger updates star_rating.
--
-- Writes one rating_seed_log row per player (source 'backfill', actor
-- null). Change the final COMMIT to ROLLBACK for a dry run.
-- ============================================================

begin;

with candidates as (
  select pr.user_id,
         pr.score as old_score,
         pr.verification,
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
         )::numeric(2,1) as seed_level
    from public.player_ratings pr
    join public.profiles p on p.id = pr.user_id
   where pr.star_provisional
     and not exists (select 1 from public.rating_seed_log l where l.user_id = pr.user_id)
   for update of pr
),
planned as (
  select c.user_id,
         c.old_score,
         c.seed_level,
         case when c.verification = 'self'
              then least(c.seed_level, public.star_seed_unverified_cap())
              else c.seed_level
         end as new_star
    from candidates c
   where c.seed_level is not null
),
updated as (
  update public.player_ratings pr
     set score = public.star_level_seed_score(pl.new_star),
         updated_at = now()
    from planned pl
   where pr.user_id = pl.user_id
  returning pr.user_id, pr.score as new_score
)
insert into public.rating_seed_log (user_id, actor_id, source, chosen_level, applied_level, old_score, new_score)
select pl.user_id, null, 'backfill', pl.seed_level, pl.new_star, pl.old_score, u.new_score
  from planned pl
  join updated u on u.user_id = pl.user_id
returning user_id, chosen_level, applied_level, old_score, new_score;

commit;
