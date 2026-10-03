-- Season prize entries: a player who accepts the fair-play pledge for a season enters that season once.
-- Additive. Nothing reads this into points, ratings or leaderboards; the app only shows a player their own entry.
--
--   * season_key is the points season, e.g. '2026-Q4' (see lib/pickup/seasonPrize.ts).
--   * RLS: a signed-in user can insert and read only their own row. No update, no delete.
--   * The API route (app/api/season-prize/entry) records entries with the service role, which bypasses RLS;
--     the policies keep direct client access to the same rule.

begin;

create table if not exists public.season_prize_entries (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  season_key    text        not null check (season_key ~ '^[0-9]{4}-Q[1-4]$'),
  accepted_at   timestamptz not null default now(),
  rules_version text,
  primary key (user_id, season_key)
);

comment on table public.season_prize_entries is
  'Players who entered the season prize by accepting the fair-play pledge. One row per user per season.';

alter table public.season_prize_entries enable row level security;

revoke all on public.season_prize_entries from anon, authenticated;
grant select, insert on public.season_prize_entries to authenticated;

drop policy if exists season_prize_entries_select_own on public.season_prize_entries;
create policy season_prize_entries_select_own on public.season_prize_entries
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists season_prize_entries_insert_own on public.season_prize_entries;
create policy season_prize_entries_insert_own on public.season_prize_entries
  for insert to authenticated
  with check (user_id = auth.uid());

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.season_prize_entries;
-- commit;
-- ============================================================
