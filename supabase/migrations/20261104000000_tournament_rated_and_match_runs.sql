-- Tournaments, step 1 of the live bracket work: two flags on tournaments, and a link from a tournament match to a game.
-- Additive and safe to run twice. NOT applied by this change; it is a file only.
--
-- Production has an outdoor tournament system whose tables are not in these migrations (tournaments, tournament_matches, ...).
-- A DEV database may not have them, so every statement below checks that the table exists first and does nothing otherwise.
--
--   * tournaments.rated             boolean not null default false   Whether a tournament's matches will count for ratings (later phase).
--   * tournaments.count_for_season  boolean not null default false   Whether they will count toward the season (later phase).
--   * tournament_match_runs         one row per tournament match that has a game (pickup_runs) behind it. Server (service role)
--                                   only: RLS is on and there are no policies.
--
-- No rating, points or season prize behavior changes here. Nothing reads the flags or the link yet.
--
-- Verify after running:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'tournaments' and column_name in ('rated', 'count_for_season');
--   select to_regclass('public.tournament_match_runs');
--   select relrowsecurity from pg_class where oid = to_regclass('public.tournament_match_runs');   -- true
--
-- Rollback (manual; nothing depends on these objects yet):
--   begin;
--   drop table if exists public.tournament_match_runs;
--   do $rb$
--   begin
--     if to_regclass('public.tournaments') is not null then
--       alter table public.tournaments drop column if exists rated;
--       alter table public.tournaments drop column if exists count_for_season;
--     end if;
--   end
--   $rb$;
--   commit;

begin;

do $flags$
begin
  if to_regclass('public.tournaments') is not null then
    alter table public.tournaments add column if not exists rated boolean not null default false;
    alter table public.tournaments add column if not exists count_for_season boolean not null default false;
    comment on column public.tournaments.rated is 'When true, this tournament''s matches will count for ratings. Off by default. Not read by anything yet.';
    comment on column public.tournaments.count_for_season is 'When true, this tournament''s matches will count toward the season. Off by default. Not read by anything yet.';
  end if;
end
$flags$;

do $links$
begin
  if to_regclass('public.tournament_matches') is not null and to_regclass('public.pickup_runs') is not null then
    create table if not exists public.tournament_match_runs (
      match_id   uuid primary key references public.tournament_matches (id) on delete cascade,
      run_id     uuid not null unique references public.pickup_runs (id) on delete cascade,
      created_at timestamptz not null default now()
    );
    comment on table public.tournament_match_runs is 'Links a tournament match to the game (pickup_runs row) behind it. Server (service role) only.';

    alter table public.tournament_match_runs enable row level security;
    revoke all on table public.tournament_match_runs from anon, authenticated;
    grant all on table public.tournament_match_runs to service_role;
  end if;
end
$links$;

commit;
