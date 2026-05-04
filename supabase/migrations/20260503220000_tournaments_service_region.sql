-- Optional hub region for outdoor / captain tournaments (NY, CT, NJ, MD).
-- Null = legacy “global” hub row (shown when no regional active tournament exists).

alter table public.tournaments
  add column if not exists service_region text null;

alter table public.tournaments
  drop constraint if exists tournaments_service_region_allowed;

alter table public.tournaments
  add constraint tournaments_service_region_allowed
  check (service_region is null or service_region in ('NY', 'CT', 'NJ', 'MD'));

comment on column public.tournaments.service_region is 'Pickup hub state for this tournament; null = legacy global hub.';

create index if not exists tournaments_active_region_idx
  on public.tournaments (service_region)
  where is_active = true;
