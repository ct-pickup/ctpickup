-- Pickup run results + per-run team assignments (for stats and awards).

create table if not exists public.pickup_run_results (
  run_id uuid not null primary key references public.pickup_runs (id) on delete cascade,

  total_teams integer not null
    constraint pickup_run_results_total_teams_check
      check (total_teams in (2, 3)),

  winning_team text not null
    constraint pickup_run_results_winning_team_check
      check (winning_team in ('A', 'B', 'C')),

  player_of_day uuid references public.profiles (id) on delete set null,
  defender_of_day uuid references public.profiles (id) on delete set null,
  midfielder_of_day uuid references public.profiles (id) on delete set null,
  attacker_of_day uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists pickup_run_results_created_at_idx
  on public.pickup_run_results (created_at desc);

create index if not exists pickup_run_results_player_of_day_idx
  on public.pickup_run_results (player_of_day);
create index if not exists pickup_run_results_defender_of_day_idx
  on public.pickup_run_results (defender_of_day);
create index if not exists pickup_run_results_midfielder_of_day_idx
  on public.pickup_run_results (midfielder_of_day);
create index if not exists pickup_run_results_attacker_of_day_idx
  on public.pickup_run_results (attacker_of_day);

comment on table public.pickup_run_results is
  'Final results + awards for a pickup run (one row per run).';

create table if not exists public.pickup_run_team_assignments (
  run_id uuid not null references public.pickup_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team text not null
    constraint pickup_run_team_assignments_team_check
      check (team in ('A', 'B', 'C')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  primary key (run_id, user_id)
);

create index if not exists pickup_run_team_assignments_run_team_idx
  on public.pickup_run_team_assignments (run_id, team);

create index if not exists pickup_run_team_assignments_user_idx
  on public.pickup_run_team_assignments (user_id);

comment on table public.pickup_run_team_assignments is
  'Per-run player team assignment (A/B/C) used to compute stats (wins/losses).';

alter table public.pickup_run_results enable row level security;
alter table public.pickup_run_team_assignments enable row level security;

-- Public player profiles need to read aggregate stats; allow select.
drop policy if exists pickup_run_results_select_all on public.pickup_run_results;
create policy pickup_run_results_select_all
  on public.pickup_run_results
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.approved = true or p.is_admin = true)
    )
  );

drop policy if exists pickup_run_team_assignments_select_all on public.pickup_run_team_assignments;
create policy pickup_run_team_assignments_select_all
  on public.pickup_run_team_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.approved = true or p.is_admin = true)
    )
  );

-- Writes are performed by the server (service role), but allow admins via RLS too.
drop policy if exists pickup_run_results_admin_write on public.pickup_run_results;
create policy pickup_run_results_admin_write
  on public.pickup_run_results
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

drop policy if exists pickup_run_team_assignments_admin_write on public.pickup_run_team_assignments;
create policy pickup_run_team_assignments_admin_write
  on public.pickup_run_team_assignments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

