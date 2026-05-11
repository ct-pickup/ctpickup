-- Official tournament roster (post-confirmation invites) and player join requests.

create table if not exists public.tournament_roster (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  captain_id uuid not null references public.tournament_captains (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('invited', 'accepted', 'declined')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (captain_id, user_id)
);

create index if not exists tournament_roster_captain_id_idx on public.tournament_roster (captain_id);
create index if not exists tournament_roster_tournament_id_idx on public.tournament_roster (tournament_id);
create index if not exists tournament_roster_user_id_idx on public.tournament_roster (user_id);

create table if not exists public.tournament_join_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  captain_id uuid not null references public.tournament_captains (id) on delete cascade,
  requester_user_id uuid not null references auth.users (id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (captain_id, requester_user_id)
);

create index if not exists tournament_join_requests_captain_id_idx on public.tournament_join_requests (captain_id);
create index if not exists tournament_join_requests_requester_idx on public.tournament_join_requests (requester_user_id);
create index if not exists tournament_join_requests_tournament_id_idx on public.tournament_join_requests (tournament_id);

-- Mobile realtime: authenticated clients may read bracket tables (writes remain service role / admin API).
do $$
begin
  if to_regclass('public.tournament_matches') is not null then
    execute 'alter table public.tournament_matches enable row level security';
    execute 'drop policy if exists tournament_matches_select_authenticated on public.tournament_matches';
    execute $p$
      create policy tournament_matches_select_authenticated
        on public.tournament_matches
        for select
        to authenticated
        using (true)
    $p$;
  end if;

  if to_regclass('public.tournament_group_members') is not null then
    execute 'alter table public.tournament_group_members enable row level security';
    execute 'drop policy if exists tournament_group_members_select_authenticated on public.tournament_group_members';
    execute $p$
      create policy tournament_group_members_select_authenticated
        on public.tournament_group_members
        for select
        to authenticated
        using (true)
    $p$;
  end if;

  if to_regclass('public.tournament_groups') is not null then
    execute 'alter table public.tournament_groups enable row level security';
    execute 'drop policy if exists tournament_groups_select_authenticated on public.tournament_groups';
    execute $p$
      create policy tournament_groups_select_authenticated
        on public.tournament_groups
        for select
        to authenticated
        using (true)
    $p$;
  end if;
end $$;
