-- Allow 30-minute minimum on max_drive_minutes (mobile slider); 90 = no upper limit in app logic.
alter table public.profiles drop constraint if exists profiles_max_drive_minutes_check;

alter table public.profiles
  add constraint profiles_max_drive_minutes_check
  check (max_drive_minutes >= 30 and max_drive_minutes <= 90);

comment on column public.profiles.max_drive_minutes is
  'Max willing drive time in minutes for pickup invites (30–90; 90 means no limit). Default 50.';
