-- Esports tournament engine: stages, groups, matches, and match result submissions.
-- Admin writes use service role from server actions (bypasses RLS).

create table if not exists public.esports_tournament_stages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.esports_tournaments (id) on delete cascade,
  type text not null check (type in ('group_stage', 'round_of_16', 'quarterfinal', 'semifinal', 'final')),
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  order_index int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'locked', 'completed')),
  created_at timestamptz not null default now()
);

create index if not exists esports_tournament_stages_tournament_idx
  on public.esports_tournament_stages (tournament_id, order_index asc);

create index if not exists esports_tournament_stages_status_idx
  on public.esports_tournament_stages (tournament_id, status);

alter table public.esports_tournament_stages enable row level security;

-- Participants can read stages for tournaments they are in (via any match row).
create policy "esports_tournament_stages_select_participant"
  on public.esports_tournament_stages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.esports_matches m
      where m.tournament_id = esports_tournament_stages.tournament_id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
  );

create table if not exists public.esports_tournament_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.esports_tournaments (id) on delete cascade,
  stage_id uuid not null references public.esports_tournament_stages (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (stage_id, name)
);

create index if not exists esports_tournament_groups_stage_idx
  on public.esports_tournament_groups (stage_id, name);

alter table public.esports_tournament_groups enable row level security;

create policy "esports_tournament_groups_select_participant"
  on public.esports_tournament_groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.esports_matches m
      where m.group_id = esports_tournament_groups.id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
  );

create table if not exists public.esports_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.esports_tournaments (id) on delete cascade,
  stage_id uuid not null references public.esports_tournament_stages (id) on delete cascade,
  group_id uuid references public.esports_tournament_groups (id) on delete set null,

  player1_user_id uuid not null references auth.users (id) on delete restrict,
  player2_user_id uuid not null references auth.users (id) on delete restrict,

  scheduled_deadline timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'reported', 'completed', 'void')),
  winner_user_id uuid references auth.users (id) on delete set null,
  score_player1 int,
  score_player2 int,

  round_label text,
  bracket_slot int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists esports_matches_tournament_idx
  on public.esports_matches (tournament_id, scheduled_deadline asc);

create index if not exists esports_matches_stage_idx
  on public.esports_matches (stage_id, scheduled_deadline asc);

create index if not exists esports_matches_group_idx
  on public.esports_matches (group_id, scheduled_deadline asc)
  where group_id is not null;

create index if not exists esports_matches_player1_idx
  on public.esports_matches (player1_user_id, scheduled_deadline asc);

create index if not exists esports_matches_player2_idx
  on public.esports_matches (player2_user_id, scheduled_deadline asc);

create index if not exists esports_matches_winner_idx
  on public.esports_matches (winner_user_id)
  where winner_user_id is not null;

alter table public.esports_matches enable row level security;

-- Players can read matches they are assigned to.
create policy "esports_matches_select_own"
  on public.esports_matches
  for select
  to authenticated
  using (auth.uid() = player1_user_id or auth.uid() = player2_user_id);

-- Players can report results for their match (write is limited; admin confirmation via service role).
create policy "esports_matches_update_own_report"
  on public.esports_matches
  for update
  to authenticated
  using (auth.uid() = player1_user_id or auth.uid() = player2_user_id)
  with check (auth.uid() = player1_user_id or auth.uid() = player2_user_id);

create table if not exists public.esports_match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.esports_matches (id) on delete cascade,
  proof_url text,
  submitted_by_user_id uuid not null references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists esports_match_results_match_idx
  on public.esports_match_results (match_id, submitted_at desc);

alter table public.esports_match_results enable row level security;

create policy "esports_match_results_select_own_match"
  on public.esports_match_results
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.esports_matches m
      where m.id = esports_match_results.match_id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
  );

create policy "esports_match_results_insert_own_match"
  on public.esports_match_results
  for insert
  to authenticated
  with check (
    submitted_by_user_id = auth.uid()
    and exists (
      select 1
      from public.esports_matches m
      where m.id = esports_match_results.match_id
        and (m.player1_user_id = auth.uid() or m.player2_user_id = auth.uid())
    )
  );

