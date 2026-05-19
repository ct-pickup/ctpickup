-- Marketing push opt-in (separate from operational push_notifications_enabled).

alter table public.profiles
  add column if not exists marketing_push_enabled boolean not null default false;

comment on column public.profiles.marketing_push_enabled is
  'User opted in to marketing/announcement push (admin broadcasts). Operational pushes use push_notifications_enabled.';

alter table public.user_push_devices
  add column if not exists marketing_push_enabled boolean not null default false;

comment on column public.user_push_devices.marketing_push_enabled is
  'Denormalized copy of profiles.marketing_push_enabled for marketing push sender queries.';

create index if not exists user_push_devices_marketing_push_enabled_idx
  on public.user_push_devices (marketing_push_enabled)
  where marketing_push_enabled = true;
