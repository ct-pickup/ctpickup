-- Lets a venue be marked source = 'manual': added by hand by an admin (not from the map import, not from a player suggestion).
-- Changes nothing else. Safe to run more than once.

begin;

alter table public.venues drop constraint if exists venues_source_check;
alter table public.venues add constraint venues_source_check check (source in ('osm', 'player', 'manual'));

comment on column public.venues.source is 'osm = from the map data import; player = added by a player and approved by an admin; manual = added by hand by an admin.';

commit;
