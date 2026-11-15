-- Seeded group draw: remember each team's seed, pot and rating average at the moment Generate Groups drew the groups.
-- Additive and safe to run twice. NOT applied by this change; it is a file only.
--
-- Three nullable columns on tournament_group_members (existing rows stay null, which the app reads as "no stored seed"):
--   seed      int            1 is the strongest team at draw time
--   pot       int            1 is the top pot (the top N seeds, N = number of groups)
--   draw_avg  numeric(4,2)   the team's average exact (display) rating at draw time; never a raw score
-- The app works without them: Generate Groups writes the same rows without these three fields when the columns are missing, and the
-- bracket then shows a seed worked out from current ratings, as before.
--
-- Rollback (manual):
--   alter table public.tournament_group_members drop column if exists seed, drop column if exists pot, drop column if exists draw_avg;
--
-- Verify after running:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'tournament_group_members' and column_name in ('seed','pot','draw_avg');  -- three rows

begin;

do $draw$
begin
  if to_regclass('public.tournament_group_members') is not null then
    execute 'alter table public.tournament_group_members add column if not exists seed int, add column if not exists pot int, add column if not exists draw_avg numeric(4,2)';
  end if;
end
$draw$;

commit;
