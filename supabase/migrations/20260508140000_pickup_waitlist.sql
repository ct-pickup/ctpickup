-- Waitlist system for pickup runs
-- Adds waitlist position + offer timestamps to pickup_run_rsvps.

alter table public.pickup_run_rsvps
  add column if not exists waitlist_position int null,
  add column if not exists waitlist_offered_at timestamptz null,
  add column if not exists waitlist_expires_at timestamptz null;

-- Optional: helpful for ordering the waitlist quickly.
create index if not exists pickup_run_rsvps_waitlist_pos_idx
  on public.pickup_run_rsvps (run_id, waitlist_position)
  where waitlist_position is not null;

create index if not exists pickup_run_rsvps_waitlist_expires_idx
  on public.pickup_run_rsvps (waitlist_expires_at)
  where waitlist_expires_at is not null;

