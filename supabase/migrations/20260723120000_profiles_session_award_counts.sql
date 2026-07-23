-- Denormalized award counters for host-recorded session results / leaderboards.

alter table public.profiles add column if not exists potd_count integer not null default 0;
alter table public.profiles add column if not exists goalie_potd_count integer not null default 0;
alter table public.profiles add column if not exists defender_potd_count integer not null default 0;
alter table public.profiles add column if not exists midfielder_potd_count integer not null default 0;
alter table public.profiles add column if not exists attacker_potd_count integer not null default 0;

update public.profiles set potd_count = coalesce(potd_count, 0);
update public.profiles set goalie_potd_count = coalesce(goalie_potd_count, 0);
update public.profiles set defender_potd_count = coalesce(defender_potd_count, 0);
update public.profiles set midfielder_potd_count = coalesce(midfielder_potd_count, 0);
update public.profiles set attacker_potd_count = coalesce(attacker_potd_count, 0);

comment on column public.profiles.potd_count is
  'Times named Player of the Day on a recorded pickup/session result.';
comment on column public.profiles.goalie_potd_count is
  'Times named Goalie of the Day on a recorded pickup/session result.';
comment on column public.profiles.defender_potd_count is
  'Times named Defender of the Day on a recorded pickup/session result.';
comment on column public.profiles.midfielder_potd_count is
  'Times named Midfielder of the Day on a recorded pickup/session result.';
comment on column public.profiles.attacker_potd_count is
  'Times named Attacker of the Day on a recorded pickup/session result.';
