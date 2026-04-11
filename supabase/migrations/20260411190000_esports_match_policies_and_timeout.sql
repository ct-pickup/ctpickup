-- Tournament-level match reporting policies and opponent_response timeout state.

-- Strong default: tournaments can opt in to requiring a score screenshot before a report is accepted.
alter table public.esports_tournaments
  add column if not exists require_match_proof boolean not null default false;

comment on column public.esports_tournaments.require_match_proof is
  'When true, POST /api/esports/matches/:id/report requires screenshot_storage_path (upload via proof-upload first).';

-- After confirmation_deadline_at: escalate to staff (default) or auto-finalize using the reporter submission (organizer opt-in).
alter table public.esports_tournaments
  add column if not exists match_no_response_policy text not null default 'staff_review'
    check (match_no_response_policy in ('staff_review', 'auto_finalize_report'));

comment on column public.esports_tournaments.match_no_response_policy is
  'staff_review: deadline expiry moves match to under_review. auto_finalize_report: apply reporter scores as official (use sparingly).';

-- Allow marking a report when the opponent never responded before the deadline (auto path).
do $$
declare
  r record;
begin
  for r in
    select c.conname as conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'esports_match_reports'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%opponent_response%'
  loop
    execute format('alter table public.esports_match_reports drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.esports_match_reports
  add constraint esports_match_reports_opponent_response_check
  check (opponent_response in ('pending', 'confirmed', 'disputed', 'timed_out'));

comment on column public.esports_match_reports.opponent_response is
  'pending: waiting on opponent; confirmed/disputed: opponent acted; timed_out: deadline passed (auto-finalize policy only).';
