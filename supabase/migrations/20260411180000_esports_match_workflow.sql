-- Post-match workflow: confirmations, disputes, proof storage, audit, conduct records.
-- Player writes to esports_matches are removed from RLS; use server routes + service role.

-- Tournament-level defaults (hours until opponent must confirm; 1–336h = 14d)
alter table public.esports_tournaments
  add column if not exists match_confirmation_deadline_hours integer not null default 48
    check (match_confirmation_deadline_hours >= 1 and match_confirmation_deadline_hours <= 336);

comment on column public.esports_tournaments.match_confirmation_deadline_hours is
  'Hours after a result report for the opponent to confirm before escalation to staff review.';

-- Expand match status (replace legacy "reported" with "awaiting_confirmation")
alter table public.esports_matches drop constraint if exists esports_matches_status_check;

update public.esports_matches
set status = 'awaiting_confirmation'
where status = 'reported';

alter table public.esports_matches
  add constraint esports_matches_status_check
  check (
    status in (
      'scheduled',
      'awaiting_confirmation',
      'disputed',
      'under_review',
      'completed',
      'void',
      'forfeit'
    )
  );

comment on column public.esports_matches.status is
  'scheduled: no report yet; awaiting_confirmation: report pending opponent; disputed: conflict; under_review: staff; completed/void/forfeit: terminal.';

alter table public.esports_matches
  add column if not exists admin_notes_internal text;

alter table public.esports_matches
  add column if not exists finalized_by_admin_user_id uuid references auth.users (id) on delete set null;

alter table public.esports_matches
  add column if not exists finalized_at timestamptz;

-- Primary report row per match (re-created when staff resets a bad report)
create table if not exists public.esports_match_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.esports_matches (id) on delete cascade,
  reporter_user_id uuid not null references auth.users (id) on delete restrict,
  reported_winner_user_id uuid references auth.users (id) on delete set null,
  score_player1 integer not null check (score_player1 >= 0),
  score_player2 integer not null check (score_player2 >= 0),
  screenshot_storage_path text,
  submitted_at timestamptz not null default now(),
  confirmation_deadline_at timestamptz not null,
  opponent_response text not null default 'pending'
    check (opponent_response in ('pending', 'confirmed', 'disputed')),
  dispute_reason text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (match_id)
);

create index if not exists esports_match_reports_reporter_idx
  on public.esports_match_reports (reporter_user_id, submitted_at desc);

create index if not exists esports_match_reports_deadline_idx
  on public.esports_match_reports (confirmation_deadline_at)
  where opponent_response = 'pending';

comment on table public.esports_match_reports is
  'Latest submitted score report for a match; opponent confirms or disputes.';

-- Append-only audit trail for match workflow events
create table if not exists public.esports_match_audit_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.esports_matches (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists esports_match_audit_events_match_idx
  on public.esports_match_audit_events (match_id, created_at desc);

comment on table public.esports_match_audit_events is
  'Immutable audit log for match workflow transitions and staff actions.';

-- Staff-issued conduct / penalties (warnings, strikes, forfeits, DQs)
create table if not exists public.esports_conduct_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tournament_id uuid references public.esports_tournaments (id) on delete set null,
  match_id uuid references public.esports_matches (id) on delete set null,
  severity text not null check (severity in ('warning', 'strike', 'forfeit', 'disqualification')),
  reason_category text,
  notes_internal text,
  created_by_admin_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists esports_conduct_records_user_idx
  on public.esports_conduct_records (user_id, created_at desc);

create index if not exists esports_conduct_records_tournament_idx
  on public.esports_conduct_records (tournament_id, created_at desc);

comment on table public.esports_conduct_records is
  'Admin-visible enforcement history (warnings, strikes, forfeits, disqualifications).';

-- ---------------------------------------------------------------------------
-- RLS: players read own match data; staff read/write via service role
-- ---------------------------------------------------------------------------

alter table public.esports_match_reports enable row level security;
alter table public.esports_match_audit_events enable row level security;
alter table public.esports_conduct_records enable row level security;

drop policy if exists "esports_match_reports_select_participant" on public.esports_match_reports;
create policy "esports_match_reports_select_participant"
  on public.esports_match_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.esports_matches m
      where m.id = esports_match_reports.match_id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
  );

drop policy if exists "esports_match_audit_select_participant_or_admin" on public.esports_match_audit_events;
create policy "esports_match_audit_select_participant_or_admin"
  on public.esports_match_audit_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.esports_matches m
      where m.id = esports_match_audit_events.match_id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin is true
    )
  );

drop policy if exists "esports_conduct_select_admin" on public.esports_conduct_records;
create policy "esports_conduct_select_admin"
  on public.esports_conduct_records
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin is true
    )
  );

-- Remove direct player updates on esports_matches (server uses service role).
drop policy if exists "esports_matches_update_own_report" on public.esports_matches;

-- Private proof bucket — uploads/downloads go through Next.js API (service role).
insert into storage.buckets (id, name, public)
values ('esports-match-proofs', 'esports-match-proofs', false)
on conflict (id) do nothing;

-- Proof access: Next.js API uses service role to upload and issue signed URLs. No storage policies for end users.

create index if not exists esports_matches_staff_review_idx
  on public.esports_matches (tournament_id, updated_at desc)
  where status in ('disputed', 'under_review');
