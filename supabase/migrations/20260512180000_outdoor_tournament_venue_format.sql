-- Outdoor captain tournament display + scheduling extras.

alter table public.tournaments
  add column if not exists venue text null;

alter table public.tournaments
  add column if not exists format_summary text null;

alter table public.tournaments
  add column if not exists entry_fee_cents integer not null default 25000;

alter table public.tournaments
  add column if not exists min_roster_players integer not null default 5;

alter table public.tournaments
  add column if not exists start_reminder_sent_at timestamptz null;

alter table public.tournaments
  add column if not exists canceled_at timestamptz null;

comment on column public.tournaments.venue is 'Human-readable venue for the outdoor tournament hub.';
comment on column public.tournaments.format_summary is 'e.g. Group stage → knockout';
comment on column public.tournaments.entry_fee_cents is 'Captain entry fee in cents (default $250).';
comment on column public.tournaments.min_roster_players is 'Minimum roster size (including captain) before bracket generation.';
comment on column public.tournaments.start_reminder_sent_at is 'When the 24h-before start push was sent (idempotent).';
comment on column public.tournaments.canceled_at is 'Staff canceled the tournament; paid captains should be refunded.';
