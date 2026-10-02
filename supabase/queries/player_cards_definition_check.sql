-- Read-only. Confirms production player_cards matches
-- supabase/migrations/20261002230000_player_cards_legacy_columns.sql.
--
-- Expected definition: user_id, star_rating, star_provisional,
-- percentile, tier, verification, sessions, reliability from
-- player_ratings pr. Expected reloptions: {security_invoker=false}.
-- Expected grants: authenticated / SELECT only (owner rows aside).
-- The comment is informational; if it differs, update the migration's
-- comment text to match production.

select pg_get_viewdef('public.player_cards'::regclass, true);

select c.reloptions
  from pg_class c
 where c.oid = 'public.player_cards'::regclass;

select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'player_cards';

select obj_description('public.player_cards'::regclass, 'pg_class');
