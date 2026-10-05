-- Season prize: let an admin disqualify an entrant, so the win moves to the next eligible player.
-- Additive. Only the server (service role) writes these columns; players have no update policy on this table.

begin;

alter table public.season_prize_entries add column if not exists disqualified_at timestamptz;
alter table public.season_prize_entries add column if not exists disqualified_by uuid references auth.users (id) on delete set null;
alter table public.season_prize_entries add column if not exists disqualified_reason text;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- alter table public.season_prize_entries drop column if exists disqualified_reason;
-- alter table public.season_prize_entries drop column if exists disqualified_by;
-- alter table public.season_prize_entries drop column if exists disqualified_at;
-- commit;
-- ============================================================
