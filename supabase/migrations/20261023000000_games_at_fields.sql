-- Games at fields: a game (pickup_runs row) can point at the field it is played at, and at the approved field request it came from.
--
--   * pickup_runs.venue_key         optional link to venues. Old games and free-text locations are untouched; location_text, latitude and
--                                   longitude stay exactly as they are and are still what the game page shows.
--   * pickup_runs.venue_request_id  optional link to the approved venue_requests row the game was created from. Unique: one request
--                                   makes at most one game. The request shows "Game created" when a game points at it.
-- Additive; safe to run more than once. Depends on pickup_runs (the app's baseline table), venues and venue_requests (20261012*).
-- Nothing is deleted: if the field or the request is ever deleted the game keeps its text location (on delete set null).

begin;

do $$
begin
  if to_regclass('public.pickup_runs') is null then
    raise exception 'public.pickup_runs does not exist in this database. Games at fields needs the app''s games table first.';
  end if;
end $$;

alter table public.pickup_runs add column if not exists venue_key text references public.venues (venue_key) on delete set null;
alter table public.pickup_runs add column if not exists venue_request_id uuid references public.venue_requests (id) on delete set null;

create unique index if not exists pickup_runs_venue_request_uidx on public.pickup_runs (venue_request_id) where venue_request_id is not null;
create index if not exists pickup_runs_venue_key_idx on public.pickup_runs (venue_key) where venue_key is not null;

comment on column public.pickup_runs.venue_key is 'The field (venues.venue_key) this game is played at, when it was created from a field. Null for free-text locations.';
comment on column public.pickup_runs.venue_request_id is 'The approved field request this game was created from. A request has at most one game.';

commit;

-- ============================================================
-- Rollback (run manually if needed; the games themselves are not touched):
--
-- begin;
-- drop index if exists public.pickup_runs_venue_request_uidx;
-- drop index if exists public.pickup_runs_venue_key_idx;
-- alter table public.pickup_runs drop column if exists venue_request_id;
-- alter table public.pickup_runs drop column if exists venue_key;
-- commit;
-- ============================================================
