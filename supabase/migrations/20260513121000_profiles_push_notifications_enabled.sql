-- Push notification opt-out (App Store Guideline 4.5.4 compliance).
-- Source of truth lives on `profiles.push_notifications_enabled`. We also
-- denormalize the flag onto `user_push_devices` so server-side push-sending
-- queries can filter cheaply with `.eq("push_notifications_enabled", true)`.
-- When a user toggles off, the mobile client also deletes their device rows
-- from `user_push_devices`; the column here is a belt-and-braces guard for any
-- rows that linger (e.g. stale upserts before delete completes).

alter table public.profiles
  add column if not exists push_notifications_enabled boolean not null default true;

comment on column public.profiles.push_notifications_enabled is
  'User-facing opt-in for non-transactional push notifications. Default true; toggled from the mobile Account screen.';

alter table public.user_push_devices
  add column if not exists push_notifications_enabled boolean not null default true;

comment on column public.user_push_devices.push_notifications_enabled is
  'Denormalized copy of profiles.push_notifications_enabled so push-sender queries can filter by this column.';

create index if not exists user_push_devices_enabled_idx
  on public.user_push_devices (push_notifications_enabled);
