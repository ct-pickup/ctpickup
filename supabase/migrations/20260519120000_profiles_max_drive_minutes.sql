-- Max willing drive time (minutes) for pickup invites and public-run push proximity.
alter table public.profiles
  add column if not exists max_drive_minutes integer not null default 50;

alter table public.profiles
  drop constraint if exists profiles_max_drive_minutes_check;

alter table public.profiles
  add constraint profiles_max_drive_minutes_check
  check (max_drive_minutes >= 35 and max_drive_minutes <= 90);

comment on column public.profiles.max_drive_minutes is
  'Maximum willing drive time in minutes for pickup invites and nearby run notifications (35–90, default 50).';
