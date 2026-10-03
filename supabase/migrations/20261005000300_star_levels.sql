-- ============================================================
-- CT Pickup — Star levels with meaning (1 of 2): schema
--
--   * star_levels mirrors shared/starLevels.ts (star, name,
--     description). __tests__/starLevels.test.ts fails if they drift.
--     Bands stay in star_bands; a level's seed score is its band
--     midpoint, computed in 20261005000400 from star_bands.
--   * profiles.stated_level: the answer to "What's the highest level
--     you've played?". Server-only, like verification_level in
--     20261005000100: client writes are ignored by
--     profiles_guard_stated_level.
--   * verification_requests.claimed_level (the player's claim) and
--     approved_level (the admin's pick). verification_requests used to
--     let players update their own rows (status included); it is now
--     read-own only. Inserts and reviews go through the API.
--   * rating_seed_log: every seed and every admin level choice.
--     Admin-readable only; written by SECURITY DEFINER functions.
--   * No scores change here.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Levels.
-- ------------------------------------------------------------
create table if not exists public.star_levels (
  star        numeric(2,1) primary key references public.star_bands(star),
  name        text not null unique,
  description text not null default ''
);

insert into public.star_levels (star, name, description) values
  (5.0, 'Pro',          'Current or former pro (MLS, NWSL, MLS NEXT Pro, USL Championship, USL League One, top leagues abroad)'),
  (4.5, 'Elite',        'USL League Two starter, WPSL starter, or D1 starter'),
  (4.0, 'College',      'D1 roster, D2/D3 starter, USL League Two or WPSL roster (non-starter), top ECNL/MLS NEXT'),
  (3.5, 'Advanced',     'D2/D3/NAIA/JUCO player, high-level club, varsity standout'),
  (3.0, 'Competitive',  'High school varsity, travel club, competitive adult league'),
  (2.5, 'Solid',        'JV or strong adult league regular'),
  (2.0, 'Recreational', 'Plays casually, comfortable on the ball'),
  (1.5, 'Developing',   ''),
  (1.0, 'Beginner',     ''),
  (0.5, 'New',          '')
on conflict (star) do update
  set name = excluded.name,
      description = excluded.description;

do $check$
begin
  if (select count(*) from public.star_levels) <> (select count(*) from public.star_bands) then
    raise exception 'star_levels must have exactly one row per star_bands row';
  end if;
end;
$check$;

alter table public.star_levels enable row level security;
revoke all on table public.star_levels from public, anon, authenticated;

-- ------------------------------------------------------------
-- Stated level on profiles.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists stated_level numeric(2,1) references public.star_levels(star),
  add column if not exists stated_level_at timestamptz;

comment on column public.profiles.stated_level is
  'Highest level the player says they have played (star_levels.star). Set by the API only.';

create or replace function public.profiles_guard_stated_level()
returns trigger
language plpgsql set search_path = public as $body$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.stated_level    := null;
      new.stated_level_at := null;
    else
      new.stated_level    := old.stated_level;
      new.stated_level_at := old.stated_level_at;
    end if;
  end if;
  return new;
end;
$body$;

drop trigger if exists profiles_guard_stated_level on public.profiles;
create trigger profiles_guard_stated_level
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_stated_level();

revoke execute on function public.profiles_guard_stated_level() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Levels on verification requests.
-- ------------------------------------------------------------
alter table public.verification_requests
  add column if not exists claimed_level numeric(2,1) references public.star_levels(star),
  add column if not exists approved_level numeric(2,1) references public.star_levels(star);

drop policy if exists own_verification on public.verification_requests;
drop policy if exists own_verification_read on public.verification_requests;
create policy own_verification_read on public.verification_requests
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on table public.verification_requests from anon, authenticated;

-- ------------------------------------------------------------
-- Seed log.
-- ------------------------------------------------------------
create table if not exists public.rating_seed_log (
  id                      bigserial primary key,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  actor_id                uuid references auth.users(id) on delete set null,
  source                  text not null check (source in ('signup', 'admin', 'backfill')),
  chosen_level            numeric(2,1) not null references public.star_levels(star),
  -- Level the score was set to after the unverified cap; null when the score was not changed.
  applied_level           numeric(2,1) references public.star_levels(star),
  old_score               numeric(5,2),
  new_score               numeric(5,2),
  verification_request_id uuid references public.verification_requests(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists rating_seed_log_user_created
  on public.rating_seed_log (user_id, created_at desc);

alter table public.rating_seed_log enable row level security;
revoke all on table public.rating_seed_log from public, anon, authenticated;
grant select on table public.rating_seed_log to authenticated;

drop policy if exists rating_seed_log_admin_read on public.rating_seed_log;
create policy rating_seed_log_admin_read on public.rating_seed_log
  for select to authenticated using (public.is_admin_uid(auth.uid()));

comment on table public.rating_seed_log is
  'Every starting-rating seed and admin level choice. Admin-readable only. Never shown to players.';

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.rating_seed_log;
-- drop policy if exists own_verification_read on public.verification_requests;
-- create policy own_verification on public.verification_requests
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- grant insert, update, delete on table public.verification_requests to authenticated;
-- alter table public.verification_requests drop column if exists approved_level;
-- alter table public.verification_requests drop column if exists claimed_level;
-- drop trigger if exists profiles_guard_stated_level on public.profiles;
-- drop function if exists public.profiles_guard_stated_level();
-- alter table public.profiles drop column if exists stated_level_at;
-- alter table public.profiles drop column if exists stated_level;
-- drop table if exists public.star_levels;
-- commit;
-- ============================================================
