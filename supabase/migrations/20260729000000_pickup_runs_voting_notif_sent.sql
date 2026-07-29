-- Track whether the 30-min post-kickoff peer voting push was sent for a run.
alter table public.pickup_runs
  add column if not exists voting_notif_sent boolean not null default false;
