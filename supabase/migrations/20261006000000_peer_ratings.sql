-- Half-star peer ratings: each attendee rates the other players 0.5-5.0 in 0.5 steps.
-- Additive. Nothing reads this table into player_ratings.score yet, and settle_session
-- and the top-3 ballot (peer_votes) are untouched.
-- Raters can only see and write their own rows; nobody can read another rater's ratings.

create table if not exists public.peer_ratings (
  session_id uuid not null references public.tier_sessions (id) on delete cascade,
  rater_id   uuid not null references auth.users (id) on delete cascade,
  ratee_id   uuid not null references auth.users (id) on delete cascade,
  stars      numeric(2,1) not null,
  created_at timestamptz not null default now(),
  primary key (session_id, rater_id, ratee_id),
  constraint peer_ratings_stars_range check (stars between 0.5 and 5.0),
  constraint peer_ratings_stars_half_step check (stars * 2 = floor(stars * 2)),
  constraint peer_ratings_not_self check (rater_id <> ratee_id)
);

create index if not exists peer_ratings_session_ratee_idx
  on public.peer_ratings (session_id, ratee_id);

alter table public.peer_ratings enable row level security;

revoke all on public.peer_ratings from anon, authenticated;
grant select, insert, update on public.peer_ratings to authenticated;

-- A rater reads only their own rows (to prefill the sheet). No one reads anyone else's.
drop policy if exists peer_ratings_read_own on public.peer_ratings;
create policy peer_ratings_read_own on public.peer_ratings
  for select to authenticated
  using (rater_id = auth.uid());

-- Insert: own rows only, for a session the rater attended, rating someone who attended it too.
drop policy if exists peer_ratings_insert_own on public.peer_ratings;
create policy peer_ratings_insert_own on public.peer_ratings
  for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (
      select 1 from public.session_attendance a
       where a.session_id = peer_ratings.session_id
         and a.user_id = auth.uid()
         and a.status = 'attended'
    )
    and exists (
      select 1 from public.session_attendance a
       where a.session_id = peer_ratings.session_id
         and a.user_id = peer_ratings.ratee_id
         and a.status = 'attended'
    )
  );

-- Update: same guard on both the existing and the new row.
drop policy if exists peer_ratings_update_own on public.peer_ratings;
create policy peer_ratings_update_own on public.peer_ratings
  for update to authenticated
  using (
    rater_id = auth.uid()
    and exists (
      select 1 from public.session_attendance a
       where a.session_id = peer_ratings.session_id
         and a.user_id = auth.uid()
         and a.status = 'attended'
    )
  )
  with check (
    rater_id = auth.uid()
    and exists (
      select 1 from public.session_attendance a
       where a.session_id = peer_ratings.session_id
         and a.user_id = auth.uid()
         and a.status = 'attended'
    )
    and exists (
      select 1 from public.session_attendance a
       where a.session_id = peer_ratings.session_id
         and a.user_id = peer_ratings.ratee_id
         and a.status = 'attended'
    )
  );
