-- ============================================================
-- CT Pickup — final scores, draws and a result edit log
--
--   * score_a / score_b: optional final score for two-team games,
--     0..30, both set or both null. When set they must agree with
--     winning_team (higher wins, equal is a draw).
--   * Draws: winning_team becomes nullable. A posted result row with
--     winning_team null is a draw. Only two-team games can be drawn.
--     Chosen over a new is_draw/outcome column because every reader
--     already treats a missing winner as "no win and no loss", so no
--     reader needs a second column to stay correct. Existing rows all
--     have a winner and satisfy every new check, so they are unchanged.
--   * pickup_run_result_edits: one row per edit of a posted result
--     (who, when, old and new values). Written by the server with the
--     service role only; RLS on with no policies and no client grants.
--
-- Ratings are not touched: settle_session never reads
-- pickup_run_results, so a draw needs no SQL change there.
-- ============================================================

begin;

alter table public.pickup_run_results
  add column if not exists score_a smallint,
  add column if not exists score_b smallint;

alter table public.pickup_run_results
  alter column winning_team drop not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pickup_run_results_score_range'
       and conrelid = 'public.pickup_run_results'::regclass
  ) then
    alter table public.pickup_run_results
      add constraint pickup_run_results_score_range
      check (
        (score_a is null and score_b is null)
        or (score_a between 0 and 30 and score_b between 0 and 30)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'pickup_run_results_score_matches_winner'
       and conrelid = 'public.pickup_run_results'::regclass
  ) then
    alter table public.pickup_run_results
      add constraint pickup_run_results_score_matches_winner
      check (
        score_a is null
        or (
          total_teams = 2
          and winning_team is not distinct from (
            case when score_a > score_b then 'A'
                 when score_b > score_a then 'B'
                 else null end
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'pickup_run_results_draw_two_teams'
       and conrelid = 'public.pickup_run_results'::regclass
  ) then
    alter table public.pickup_run_results
      add constraint pickup_run_results_draw_two_teams
      check (winning_team is not null or total_teams = 2);
  end if;
end;
$constraints$;

comment on column public.pickup_run_results.winning_team is
  'A, B or C. Null on a posted result means a draw (two-team games only).';
comment on column public.pickup_run_results.score_a is
  'Final score for Team A (0..30). Null when the score was not tracked.';
comment on column public.pickup_run_results.score_b is
  'Final score for Team B (0..30). Null when the score was not tracked.';

create table if not exists public.pickup_run_result_edits (
  id          bigserial primary key,
  run_id      uuid not null references public.pickup_runs (id) on delete cascade,
  edited_by   uuid references public.profiles (id) on delete set null,
  editor_role text not null check (editor_role in ('host', 'admin')),
  edited_at   timestamptz not null default now(),
  old_values  jsonb not null,
  new_values  jsonb not null
);

create index if not exists pickup_run_result_edits_run_idx
  on public.pickup_run_result_edits (run_id, edited_at desc);

comment on table public.pickup_run_result_edits is
  'Append-only log of edits to posted pickup results. Server (service role) writes only.';

alter table public.pickup_run_result_edits enable row level security;
revoke all on table public.pickup_run_result_edits from anon, authenticated;
revoke all on sequence public.pickup_run_result_edits_id_seq from anon, authenticated;

commit;

-- ============================================================
-- Rollback (run manually if needed; fails while draws exist):
--
-- begin;
-- drop table if exists public.pickup_run_result_edits;
-- alter table public.pickup_run_results drop constraint if exists pickup_run_results_draw_two_teams;
-- alter table public.pickup_run_results drop constraint if exists pickup_run_results_score_matches_winner;
-- alter table public.pickup_run_results drop constraint if exists pickup_run_results_score_range;
-- alter table public.pickup_run_results alter column winning_team set not null;
-- alter table public.pickup_run_results drop column if exists score_b;
-- alter table public.pickup_run_results drop column if exists score_a;
-- commit;
-- ============================================================
