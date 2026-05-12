-- Tiebreaker column for group standings (used by knockout seeding + admin bracket UI).

alter table public.tournament_group_members add column if not exists goal_difference integer not null default 0;

update public.tournament_group_members
set goal_difference = coalesce(goals_for, 0) - coalesce(goals_against, 0)
where goal_difference is distinct from (coalesce(goals_for, 0) - coalesce(goals_against, 0));
