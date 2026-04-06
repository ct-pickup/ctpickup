-- Ensure esports + goalie columns exist (fixes DBs that never ran earlier migrations)
-- and add online ID for tournament matchmaking.

alter table public.profiles add column if not exists esports_interest text;
alter table public.profiles add column if not exists esports_platform text;
alter table public.profiles add column if not exists esports_console text;
alter table public.profiles add column if not exists plays_goalie boolean;
alter table public.profiles add column if not exists esports_online_id text;

comment on column public.profiles.esports_interest is 'yes | no | later — prize esports; later = deferred.';
comment on column public.profiles.esports_platform is 'xbox | playstation — only when esports_interest = yes.';
comment on column public.profiles.esports_console is 'xbox_series_xs | xbox_one | ps5 | ps4 — only when esports_interest = yes.';
comment on column public.profiles.esports_online_id is 'Gamertag (Xbox) or Online ID (PSN); only when esports_interest = yes.';
comment on column public.profiles.plays_goalie is 'Pickup: willing to play goalie.';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'profiles' and c.conname = 'profiles_esports_interest_check'
  ) then
    alter table public.profiles
      add constraint profiles_esports_interest_check
      check (esports_interest is null or esports_interest in ('yes', 'no', 'later'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'profiles' and c.conname = 'profiles_esports_platform_check'
  ) then
    alter table public.profiles
      add constraint profiles_esports_platform_check
      check (esports_platform is null or esports_platform in ('xbox', 'playstation'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'profiles' and c.conname = 'profiles_esports_console_check'
  ) then
    alter table public.profiles
      add constraint profiles_esports_console_check
      check (
        esports_console is null
        or esports_console in ('xbox_series_xs', 'xbox_one', 'ps5', 'ps4')
      );
  end if;
end $$;
