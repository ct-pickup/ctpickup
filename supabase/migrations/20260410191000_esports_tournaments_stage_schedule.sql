-- Esports tournaments: add stage schedule fields and a manual knockout bracket blob.
-- These are nullable so staff can draft a tournament, then fill deadlines before publishing.

alter table public.esports_tournaments
  add column if not exists group_stage_deadline_1 timestamptz,
  add column if not exists group_stage_deadline_2 timestamptz,
  add column if not exists group_stage_final_deadline timestamptz,
  add column if not exists knockout_start_at timestamptz,
  add column if not exists quarterfinal_deadline timestamptz,
  add column if not exists semifinal_deadline timestamptz,
  add column if not exists final_deadline timestamptz,
  add column if not exists format_summary text,
  add column if not exists knockout_bracket jsonb;

comment on column public.esports_tournaments.group_stage_deadline_1 is
  'Stage deadline (ET) for first set of group-stage matches.';
comment on column public.esports_tournaments.group_stage_deadline_2 is
  'Stage deadline (ET) for second set of group-stage matches.';
comment on column public.esports_tournaments.group_stage_final_deadline is
  'Final cutoff (ET) to submit all group-stage results.';
comment on column public.esports_tournaments.knockout_start_at is
  'Time (ET) when knockout stage begins / bracket may be posted.';
comment on column public.esports_tournaments.knockout_bracket is
  'Manual knockout bracket (admin-managed) as JSON.';

