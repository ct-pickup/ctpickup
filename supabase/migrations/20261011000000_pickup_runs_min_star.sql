-- A game's minimum skill level as a half star (0.5 to 5.0), set by the host. Additive.
--
--   * Nullable: null means "All levels", or a game made before this column existed. Existing rows are not changed
--     and nothing is backfilled; they keep using open_tier_rank as today.
--   * New games also keep min_tier / open_tier_rank set to the tier band that contains the star, so older app
--     builds and the tier gate keep working.
--   * The code tolerates this column being missing, so the API can deploy before this runs.

begin;

alter table public.pickup_runs add column if not exists min_star numeric(2,1);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pickup_runs_min_star_half_step'
  ) then
    alter table public.pickup_runs
      add constraint pickup_runs_min_star_half_step
      check (min_star is null or (min_star between 0.5 and 5.0 and (min_star * 2) = floor(min_star * 2)));
  end if;
end $$;

comment on column public.pickup_runs.min_star is
  'Host-chosen minimum skill level in half stars, 0.5 to 5.0. Null = all levels (or a game made before this column; see open_tier_rank).';

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- alter table public.pickup_runs drop constraint if exists pickup_runs_min_star_half_step;
-- alter table public.pickup_runs drop column if exists min_star;
-- commit;
-- ============================================================
