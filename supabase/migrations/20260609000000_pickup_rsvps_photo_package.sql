-- Photo package add-on for pickup run RSVPs.
-- Players can opt in to receive action photos (+$5) at checkout.

alter table public.pickup_run_rsvps
  add column if not exists photo_package boolean not null default false;
